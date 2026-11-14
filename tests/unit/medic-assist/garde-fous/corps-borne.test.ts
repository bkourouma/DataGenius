import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const garde = vi.hoisted(() => ({ exigerMedicAssist: vi.fn() }))
vi.mock('@/lib/medic-assist/acces', () => garde)

const executer = vi.hoisted(() => ({ executerChat: vi.fn() }))
vi.mock('@/lib/medic-assist/agent/executer', () => executer)

const pj = vi.hoisted(() => ({ enregistrerPieceJointe: vi.fn() }))
vi.mock('@/lib/medic-assist/pieces-jointes/service', () => pj)

const dictee = vi.hoisted(() => ({
  lireConfigMedicAssist: vi.fn(),
  moteur: vi.fn(),
  quota: vi.fn(),
  depot: vi.fn(),
  transcrire: vi.fn(),
}))
vi.mock('@/lib/medic-assist/admin/dependances', async importOriginal => ({
  ...(await importOriginal<object>()),
  exigerMedicAssist: garde.exigerMedicAssist,
  lireConfigMedicAssist: dictee.lireConfigMedicAssist,
}))
vi.mock('@/lib/medic-assist/transcription/moteur', () => ({
  moteurTranscriptionEffectif: dictee.moteur,
}))
vi.mock('@/lib/medic-assist/agent/quota', () => ({ verifierQuotaJournalier: dictee.quota }))
vi.mock('@/lib/medic-assist/transcription/depot-prisma', () => ({
  enregistrerUsageTranscription: dictee.depot,
}))
vi.mock('@/lib/medic-assist/transcription/transcrire', async importOriginal => ({
  ...(await importOriginal<object>()),
  transcrire: dictee.transcrire,
}))

import { POST as chat } from '@/app/api/medic-assist/chat/route'
import { POST as piecesJointes } from '@/app/api/medic-assist/pieces-jointes/route'
import { POST as transcription } from '@/app/api/medic-assist/transcription/route'
import { lireCorps } from '@/lib/integration/http'
import {
  CorpsTropVolumineux,
  lireOctetsBornes,
  lireTexteBorne,
  requeteDepuisOctets,
} from '@/lib/http/corps-borne'
import { LIMITES } from '@/lib/medic-assist/contrats'
import { reinitialiserLimiteurTranscription } from '@/lib/medic-assist/transcription/limite'

const MO = 1024 * 1024

/** Flux fragmenté sans content-length ; compte les fragments réellement tirés. */
function fluxFragmente(fragments: number, taille: number) {
  const etat = { tires: 0 }
  const flux = new ReadableStream<Uint8Array>({
    pull(controleur) {
      if (etat.tires >= fragments) return controleur.close()
      etat.tires += 1
      controleur.enqueue(new Uint8Array(taille).fill(97))
    },
  })
  return { flux, etat }
}

function requeteFlux(
  url: string,
  flux: ReadableStream<Uint8Array>,
  entetes: Record<string, string> = {}
) {
  return new NextRequest(url, {
    method: 'POST',
    headers: entetes,
    body: flux,
    duplex: 'half',
  } as RequestInit)
}

/** Multipart écrit à la main (le FormData de jsdom ne se sérialise pas comme celui de Node). */
function multipartManuel(champ: string, nom: string, contenu: string) {
  return (
    `--BORNE\r\nContent-Disposition: form-data; name="${champ}"; filename="${nom}"\r\n` +
    `Content-Type: text/csv\r\n\r\n${contenu}\r\n--BORNE--\r\n`
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  reinitialiserLimiteurTranscription()
  const contexte = { userId: 'u1', locale: 'fr', roleName: 'Member' }
  garde.exigerMedicAssist.mockResolvedValue({ ok: true, contexte })
  dictee.lireConfigMedicAssist.mockResolvedValue({ transcription: {}, plafondCoutJournalierUsd: 0 })
  dictee.moteur.mockReturnValue({ fournisseur: 'openai', modele: 'whisper' })
  dictee.quota.mockResolvedValue({ autorise: true })
  dictee.depot.mockResolvedValue(undefined)
})

describe('lireOctetsBornes / lireTexteBorne', () => {
  it('lit un corps sous le plafond', async () => {
    const r = new Request('http://x/', { method: 'POST', body: 'bonjour é' })
    expect(await lireTexteBorne(r, 100)).toBe('bonjour é')
    const r2 = new Request('http://x/', { method: 'POST', body: new Uint8Array([1, 2, 3]) })
    expect([...(await lireOctetsBornes(r2, 3))]).toEqual([1, 2, 3])
  })

  it('rejette au-delà du plafond sans lire tout le flux', async () => {
    const { flux, etat } = fluxFragmente(1000, 1024)
    await expect(lireOctetsBornes({ body: flux }, 4096)).rejects.toBeInstanceOf(CorpsTropVolumineux)
    expect(etat.tires).toBeLessThan(20)
  })

  it('corps absent : vide', async () => {
    expect((await lireOctetsBornes(new Request('http://x/'), 10)).byteLength).toBe(0)
  })
})

describe('lireCorps historique (intégration) inchangé', () => {
  it('lit, rejette au-delà avec « Corps trop volumineux », vide sans corps', async () => {
    expect(await lireCorps(new Request('http://x/', { method: 'POST', body: '{"a":1}' }))).toBe(
      '{"a":1}'
    )
    await expect(
      lireCorps(new Request('http://x/', { method: 'POST', body: 'x'.repeat(20) }), 10)
    ).rejects.toThrow('Corps trop volumineux')
    expect(await lireCorps(new Request('http://x/'))).toBe('')
  })
})

describe('POST /chat : corps borné', () => {
  it('413 payload_too_large sur envoi fragmenté sans content-length, flux non lu en entier', async () => {
    const max = LIMITES.tailleMaxRequeteChatOctets
    const total = Math.ceil((max * 2) / MO)
    const { flux, etat } = fluxFragmente(total, MO)
    const reponse = await chat(requeteFlux('http://localhost/api/medic-assist/chat', flux))
    expect(reponse.status).toBe(413)
    expect((await reponse.json()).error).toBe('payload_too_large')
    expect(etat.tires).toBeLessThan(total)
    expect(executer.executerChat).not.toHaveBeenCalled()
  })

  it('corps valide : passe à executerChat avec le signal', async () => {
    executer.executerChat.mockResolvedValue({ type: 'reponse', reponse: new Response('ok') })
    const r = new NextRequest('http://localhost/api/medic-assist/chat', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    })
    const reponse = await chat(r)
    expect(reponse.status).toBe(200)
    expect(executer.executerChat).toHaveBeenCalledWith(
      expect.objectContaining({ corps: { a: 1 }, signal: r.signal })
    )
  })

  it('exception inattendue : 500 avec référence, sans détail', async () => {
    executer.executerChat.mockRejectedValue(new Error('secret'))
    const r = new NextRequest('http://localhost/api/medic-assist/chat', {
      method: 'POST',
      body: '{}',
    })
    const reponse = await chat(r)
    expect(reponse.status).toBe(500)
    const corps = await reponse.json()
    expect(corps.details.reference).toMatch(/^DG-/)
    expect(JSON.stringify(corps)).not.toContain('secret')
  })
})

describe('POST /pieces-jointes : corps borné', () => {
  it('413 fichierTropGros en envoi fragmenté, flux non lu en entier', async () => {
    const total = Math.ceil(((LIMITES.tailleMaxPieceJointeOctets + MO) * 3) / MO)
    const { flux, etat } = fluxFragmente(total, MO)
    const reponse = await piecesJointes(
      requeteFlux('http://localhost/api/medic-assist/pieces-jointes', flux, {
        'content-type': 'multipart/form-data; boundary=x',
      })
    )
    expect(reponse.status).toBe(413)
    expect((await reponse.json()).error).toBe('fichierTropGros')
    expect(etat.tires).toBeLessThan(total)
    expect(pj.enregistrerPieceJointe).not.toHaveBeenCalled()
  })

  it('requête reconstruite : mêmes en-têtes (frontière), mêmes octets, POST', async () => {
    // Le parseur multipart d'undici ne tourne pas sous jsdom : on vérifie la reconstruction.
    const source = new NextRequest('http://localhost/api/medic-assist/pieces-jointes', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=BORNE', 'content-length': '999' },
      body: multipartManuel('fichier', 'a.csv', 'a;b'),
    })
    const octets = await lireOctetsBornes(source, 10_000)
    const copie = requeteDepuisOctets(source, octets)
    expect(copie.method).toBe('POST')
    expect(copie.url).toBe(source.url)
    expect(copie.headers.get('content-type')).toBe('multipart/form-data; boundary=BORNE')
    expect(copie.headers.get('content-length')).not.toBe('999')
    expect(new Uint8Array(await copie.arrayBuffer())).toEqual(octets)
  })
})

describe('POST /transcription : corps borné', () => {
  it('413 audioTropGros en envoi fragmenté, flux non lu en entier', async () => {
    const total = Math.ceil(((LIMITES.tailleMaxAudioOctets + 64 * 1024) * 3) / MO)
    const { flux, etat } = fluxFragmente(total, MO)
    const reponse = await transcription(
      requeteFlux('http://localhost/api/medic-assist/transcription', flux, {
        'content-type': 'multipart/form-data; boundary=x',
      })
    )
    expect(reponse.status).toBe(413)
    expect((await reponse.json()).error).toBe('audioTropGros')
    expect(etat.tires).toBeLessThan(total)
    expect(dictee.transcrire).not.toHaveBeenCalled()
  })

  it('21e dictée : 429 limiteDebit avec Retry-After et référence', async () => {
    for (let i = 0; i < 20; i += 1) {
      const f = new FormData()
      f.set('audio', new File([new Uint8Array(4)], 'a.webm', { type: 'audio/webm' }))
      await transcription(
        new NextRequest('http://localhost/api/medic-assist/transcription', {
          method: 'POST',
          body: f,
        })
      )
    }
    const reponse = await transcription(
      new NextRequest('http://localhost/api/medic-assist/transcription', {
        method: 'POST',
        body: new FormData(),
      })
    )
    expect(reponse.status).toBe(429)
    expect(Number(reponse.headers.get('Retry-After'))).toBeGreaterThan(0)
    const corps = await reponse.json()
    expect(corps.error).toBe('limiteDebit')
    expect(corps.details.reference).toMatch(/^DG-/)
  })

  it('plafond de coût atteint : 429 quotaEpuise avec reinitialisationA, sans lire le corps', async () => {
    const fin = new Date('2026-11-13T23:00:00Z')
    dictee.quota.mockResolvedValue({
      autorise: false,
      plafondUsd: 1,
      consommeUsd: 1,
      reinitialisationA: fin,
    })
    dictee.lireConfigMedicAssist.mockResolvedValue({ transcription: {}, plafondCoutJournalierUsd: 1 })
    const { flux, etat } = fluxFragmente(5, 1024)
    const reponse = await transcription(
      requeteFlux('http://localhost/api/medic-assist/transcription', flux, {
        'content-type': 'multipart/form-data; boundary=x',
      })
    )
    expect(reponse.status).toBe(429)
    const corps = await reponse.json()
    expect(corps.error).toBe('quotaEpuise')
    expect(corps.details.reinitialisationA).toBe(fin.toISOString())
    expect(dictee.quota).toHaveBeenCalledWith('u1', 1)
    expect(etat.tires).toBeLessThanOrEqual(1) // amorce du constructeur, jamais lu par la route
  })
})
