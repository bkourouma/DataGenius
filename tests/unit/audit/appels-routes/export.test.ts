/**
 * Appels d'audit de la route d'export (export.artefact) : branche buffer (sans attendre) et
 * branche flux (uniquement à la fin normale du flux). Garde, orchestrateur et audit sont doublés.
 */
import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exigerMedicAssist: vi.fn(),
  enregistrerAudit: vi.fn(),
  construireExport: vi.fn(),
}))
vi.mock('@/lib/medic-assist/acces', () => ({ exigerMedicAssist: mocks.exigerMedicAssist }))
vi.mock('@/lib/audit/enregistrer', () => ({ enregistrerAudit: mocks.enregistrerAudit }))
vi.mock('@/lib/audit/ip', () => ({ ipRequeteCourante: () => '203.0.113.9' }))
vi.mock('@/lib/journal', () => ({
  journal: { erreur: vi.fn(), info: vi.fn(), avertissement: vi.fn() },
}))
vi.mock('@/lib/medic-assist/artefacts/exports/construire-export', () => ({
  construireExport: mocks.construireExport,
  estFormatExport: (v: unknown) => ['xlsx', 'csv', 'pdf', 'pptx'].includes(v as string),
  LIGNES_MAX_EXPORT: 100_000,
}))

import { GET } from '@/app/api/medic-assist/artefacts/[id]/export/route'
import { semaphoreExports } from '@/lib/medic-assist/artefacts/exports/semaphore'
import { ErreurExport } from '@/lib/medic-assist/artefacts/ports'

const CONTEXTE = {
  userId: 'u1',
  roleName: 'CountryLead',
  scope: { isGlobal: false },
  habilitations: null,
  locale: 'fr',
  maintenant: new Date(2026, 10, 2),
}
const TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const appeler = (query = '?format=xlsx', id = 'a1') =>
  GET(new NextRequest(`http://localhost/api/medic-assist/artefacts/a1/export${query}`), { params: { id } })

const buffer = () => ({ buffer: Buffer.from('PKx'), nomFichier: 'a.xlsx', typeMime: TYPE_XLSX })
const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Flux source piloté : on décide quand il produit un morceau, se ferme ou échoue. */
function fluxPilote() {
  let controleur!: ReadableStreamDefaultController<Uint8Array>
  const flux = new ReadableStream<Uint8Array>({
    start(c) {
      controleur = c
    },
  })
  return {
    flux,
    pousser: (t: string) => controleur.enqueue(new TextEncoder().encode(t)),
    fermer: () => controleur.close(),
    echouer: (e: Error) => controleur.error(e),
  }
}
const resultatFlux = (flux: ReadableStream<Uint8Array>) => ({
  flux,
  nomFichier: 'a.xlsx',
  typeMime: TYPE_XLSX,
})

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.enregistrerAudit.mockResolvedValue(undefined)
  mocks.exigerMedicAssist.mockResolvedValue({
    ok: true,
    session: { user: { id: 'u1', name: 'Aïcha' } },
    scope: CONTEXTE.scope,
    contexte: CONTEXTE,
  })
})
afterEach(() => {
  expect(semaphoreExports.utilisees).toBe(0)
})

describe('export.artefact : branche buffer', () => {
  it('un export réussi journalise une seule fois, avec format, version et cible', async () => {
    mocks.construireExport.mockResolvedValue(buffer())
    const r = await appeler('?format=pdf&version=3', 'art7')
    expect(r.status).toBe(200)
    expect(mocks.enregistrerAudit).toHaveBeenCalledTimes(1)
    const entree = mocks.enregistrerAudit.mock.calls[0][0]
    expect(entree).toMatchObject({
      acteurId: 'u1',
      action: 'export.artefact',
      cible: { type: 'artefact', id: 'art7' },
      details: { format: 'pdf', version: 3 },
    })
    expect(mocks.construireExport.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enregistrerAudit.mock.invocationCallOrder[0]
    )
  })

  it('sans version demandée, la version journalisée est null', async () => {
    mocks.construireExport.mockResolvedValue(buffer())
    await appeler('?format=csv')
    expect(mocks.enregistrerAudit.mock.calls[0][0].details).toEqual({ format: 'csv', version: null })
  })
})

describe('export.artefact : aucun audit sur les refus et erreurs', () => {
  it.each([401, 403])('refus du garde (%i)', async statut => {
    mocks.exigerMedicAssist.mockResolvedValue({
      ok: false,
      reponse: NextResponse.json({ error: 'x', message: 'x' }, { status: statut }),
    })
    expect((await appeler()).status).toBe(statut)
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })

  it('identifiant invalide (400)', async () => {
    expect((await appeler('?format=xlsx', 'a b')).status).toBe(400)
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })

  it('format invalide (400)', async () => {
    expect((await appeler('?format=docx')).status).toBe(400)
    expect((await appeler('')).status).toBe(400)
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })

  it.each([
    ['introuvable', 404],
    ['jeu_indisponible', 404],
    ['format_non_supporte', 400],
    ['trop_de_lignes', 413],
    ['echec', 500],
  ] as const)('ErreurExport %s (%i)', async (code, statut) => {
    mocks.construireExport.mockRejectedValue(new ErreurExport(code))
    expect((await appeler()).status).toBe(statut)
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })

  it('exports occupés (503)', async () => {
    const prises: (() => void)[] = []
    for (let i = 0; i < semaphoreExports.capacite; i += 1) {
      const l = semaphoreExports.essayerPrendre()
      if (l) prises.push(l)
    }
    try {
      expect((await appeler()).status).toBe(503)
      expect(mocks.construireExport).not.toHaveBeenCalled()
      expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
    } finally {
      prises.forEach(l => l())
    }
  })
})

describe('export.artefact : branche flux', () => {
  it('la réponse précède la fin du flux ; un seul audit une fois le flux lu, avec l’IP', async () => {
    const source = fluxPilote()
    mocks.construireExport.mockResolvedValue(resultatFlux(source.flux))
    const r = await appeler('?format=xlsx&version=2', 'art9')
    expect(r.status).toBe(200)
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()

    const lecteur = r.body!.getReader()
    source.pousser('PK')
    const premier = await lecteur.read()
    expect(premier.done).toBe(false)
    await pause(20)
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()

    source.fermer()
    expect((await lecteur.read()).done).toBe(true)
    expect(mocks.enregistrerAudit).toHaveBeenCalledTimes(1)
    expect(mocks.enregistrerAudit.mock.calls[0][0]).toEqual({
      acteurId: 'u1',
      action: 'export.artefact',
      cible: { type: 'artefact', id: 'art9' },
      details: { format: 'xlsx', version: 2 },
      ip: '203.0.113.9',
    })
  })

  it('flux consommé via text() : un seul appel', async () => {
    const source = fluxPilote()
    source.pousser('abc')
    source.fermer()
    mocks.construireExport.mockResolvedValue(resultatFlux(source.flux))
    const r = await appeler()
    expect(await r.text()).toBe('abc')
    expect(mocks.enregistrerAudit).toHaveBeenCalledTimes(1)
  })

  it('erreur de lecture en cours de flux : aucun audit', async () => {
    const source = fluxPilote()
    source.pousser('PK')
    source.echouer(new TypeError('boum'))
    mocks.construireExport.mockResolvedValue(resultatFlux(source.flux))
    const r = await appeler()
    await expect(r.text()).rejects.toBeDefined()
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })

  it('annulation par reader.cancel() : aucun audit', async () => {
    const source = fluxPilote()
    source.pousser('PK')
    mocks.construireExport.mockResolvedValue(resultatFlux(source.flux))
    const r = await appeler()
    const lecteur = r.body!.getReader()
    await lecteur.read()
    await lecteur.cancel()
    await pause(20)
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })

  it('annulation par body.cancel() sans lecture : aucun audit', async () => {
    const source = fluxPilote()
    source.pousser('PK')
    mocks.construireExport.mockResolvedValue(resultatFlux(source.flux))
    const r = await appeler()
    await r.body!.cancel()
    await pause(20)
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })

  it('délai maximal dépassé : aucun audit', async () => {
    vi.useFakeTimers()
    try {
      const source = fluxPilote()
      mocks.construireExport.mockResolvedValue(resultatFlux(source.flux))
      const r = await appeler()
      const lecture = r.text().catch(e => e)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000)
      expect(await lecture).toBeInstanceOf(Error)
      expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('export.artefact : un audit qui ne se résout jamais', () => {
  const jamais = () => new Promise<void>(() => {})

  it('ne retarde pas la réponse en buffer', async () => {
    mocks.enregistrerAudit.mockReturnValue(jamais())
    mocks.construireExport.mockResolvedValue(buffer())
    const debut = Date.now()
    const r = await Promise.race([appeler(), pause(1000).then(() => 'delai' as const)])
    expect(r).not.toBe('delai')
    expect(Date.now() - debut).toBeLessThan(500)
    expect((r as Response).status).toBe(200)
    expect(Buffer.from(await (r as Response).arrayBuffer()).toString()).toBe('PKx')
  })

  it('ne retarde pas la réponse en flux et ne fait pas échouer le flux', async () => {
    mocks.enregistrerAudit.mockReturnValue(jamais())
    const source = fluxPilote()
    source.pousser('PK')
    source.fermer()
    mocks.construireExport.mockResolvedValue(resultatFlux(source.flux))
    const debut = Date.now()
    const r = await Promise.race([appeler(), pause(1000).then(() => 'delai' as const)])
    expect(r).not.toBe('delai')
    expect(Date.now() - debut).toBeLessThan(500)
    const texte = await Promise.race([(r as Response).text(), pause(1000).then(() => 'delai')])
    expect(texte).toBe('PK')
    expect(mocks.enregistrerAudit).toHaveBeenCalledTimes(1)
  })
})
