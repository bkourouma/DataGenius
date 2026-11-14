/**
 * Modèle de secours (R14) : bascule dans `avecReprise` (reprise.ts) après épuisement des
 * reprises sur indisponibilité, avant tout contenu, une fois par étape ; puis branchement dans
 * executerChat (usage au modèle et au tarif réellement utilisés). Fournisseurs simulés par
 * `MockLanguageModelV4` de 'ai/test', attentes de reprise factices.
 */
import { tool } from 'ai'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reinitialiserBase, tables } from './_base-memoire'
import {
  configDe,
  contexteDe,
  corpsMessage,
  erreurAuthentification,
  erreurSurcharge,
  etapeAppelOutil,
  etapeErreur,
  etapeTexte,
  lireJusquauBout,
  modeleSimule,
  type Morceau,
} from './_banc-chat'

// Marqueur de test : ZZLBSECOURS

const h = vi.hoisted(() => ({
  creerModele: vi.fn(),
  lireConfig: vi.fn(),
  quota: vi.fn(),
  outils: {} as Record<string, unknown>,
}))

vi.mock('@/lib/db/client', async () => {
  const { base } = await import('./_base-memoire')
  return { prisma: base, default: base }
})
vi.mock('@/lib/medic-assist/config', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/config')>()),
  creerModele: h.creerModele,
  lireConfigMedicAssist: h.lireConfig,
}))
vi.mock('@/lib/medic-assist/agent/quota', () => ({ verifierQuotaJournalier: h.quota }))
vi.mock('@/lib/medic-assist/agent/reference', () => ({ genererReference: () => 'DG-TEST03' }))
vi.mock('@/lib/medic-assist/agent/outils-adaptateur', () => ({ creerOutilsReels: () => h.outils }))
vi.mock('@/lib/medic-assist/donnees/outils', () => ({
  resumeCatalogueCompact: async () => 'Catalogue de test',
}))
// Reprises du chat sans attente réelle (deux reprises d'1 ms), le reste de reprise.ts intact.
vi.mock('@/lib/medic-assist/agent/reprise', async importOriginal => {
  const reel = await importOriginal<typeof import('@/lib/medic-assist/agent/reprise')>()
  return {
    ...reel,
    avecReprise: (modele: never, options: Parameters<typeof reel.avecReprise>[1] = {}) =>
      reel.avecReprise(modele, {
        ...options,
        politique: { delaisMs: [1, 1], gigue: 0, attendre: async () => undefined },
      }),
  }
})

import { executerChat } from '@/lib/medic-assist/agent/executer'
import {
  adapterParametresSecours,
  avecReprise,
  type InfoBascule,
  type PolitiqueReprise,
} from '@/lib/medic-assist/agent/reprise'
import { calculerCoutUsd } from '@/lib/medic-assist/config'

const SANS_ATTENTE: PolitiqueReprise = { delaisMs: [1, 1], gigue: 0, attendre: async () => undefined }

async function lireTout(modele: unknown, params: Record<string, unknown> = { prompt: [] }) {
  const resultat = await (
    modele as { doStream: (o: unknown) => Promise<{ stream: ReadableStream<Morceau> }> }
  ).doStream(params)
  const morceaux: Morceau[] = []
  const lecteur = resultat.stream.getReader()
  try {
    for (;;) {
      const lu = await lecteur.read()
      if (lu.done) break
      morceaux.push(lu.value)
    }
  } catch (erreur) {
    return { morceaux, erreur }
  }
  return { morceaux }
}

const types = (morceaux: Morceau[]) => morceaux.map(m => m.type)
const textes = (morceaux: Morceau[]) =>
  morceaux.filter(m => m.type === 'text-delta').map(m => m.delta)

function secoursOpenAI(etape: (n: number, o: unknown) => Morceau[] = () => etapeTexte('Secours')) {
  return modeleSimule(etape, 'openai.responses', 'gpt-6.1-sol')
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('avecReprise : bascule vers le modèle de secours', () => {
  it('reprises épuisées sur surcharge -> une bascule, contenu du secours, journal sans secret', async () => {
    const principal = modeleSimule(() => etapeErreur())
    const secours = secoursOpenAI()
    const bascules: InfoBascule[] = []
    const { modele } = avecReprise(principal as never, {
      politique: SANS_ATTENTE,
      secours: {
        modele: secours as never,
        fournisseur: 'openai',
        modeleId: 'gpt-6.1-sol',
        surBascule: info => bascules.push(info),
      },
      journal: { reference: 'DG-REF001', conversationId: 'conv-1' },
    })

    const { morceaux, erreur } = await lireTout(modele)
    expect(erreur).toBeUndefined()
    expect(types(morceaux)).not.toContain('error')
    expect(textes(morceaux)).toEqual(['Secours'])
    expect(principal.doStreamCalls).toHaveLength(3) // 1 essai + 2 reprises
    expect(secours.doStreamCalls).toHaveLength(1)
    expect(bascules).toEqual([
      {
        de: 'anthropic.messages/claude-sonnet-5-5',
        vers: 'openai/gpt-6.1-sol',
        fournisseur: 'openai',
        modeleId: 'gpt-6.1-sol',
        cause: 'fournisseur_indisponible',
      },
    ])
    expect(console.warn).toHaveBeenCalledWith('[datagenius] chat', {
      reference: 'DG-REF001',
      conversationId: 'conv-1',
      evenement: 'bascule_modele_secours',
      de: 'anthropic.messages/claude-sonnet-5-5',
      vers: 'openai/gpt-6.1-sol',
      cause: 'fournisseur_indisponible',
    })
  })

  it('erreur levée par doStream (429 limite de débit) -> bascule aussi', async () => {
    const principal = new (await import('ai/test')).MockLanguageModelV4({
      provider: 'anthropic.messages',
      modelId: 'claude-sonnet-5-5',
      doStream: async () => {
        throw { name: 'APICallError', statusCode: 429, message: 'rate limited' }
      },
    })
    const secours = secoursOpenAI()
    const { modele } = avecReprise(principal as never, {
      politique: SANS_ATTENTE,
      secours: { modele: secours as never, fournisseur: 'openai', modeleId: 'gpt-6.1-sol' },
    })
    const { morceaux, erreur } = await lireTout(modele)
    expect(erreur).toBeUndefined()
    expect(textes(morceaux)).toEqual(['Secours'])
    expect(secours.doStreamCalls).toHaveLength(1)
  })

  it('pas de bascule si du contenu a déjà été transmis', async () => {
    const principal = modeleSimule(() => [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Début' },
      { type: 'error', error: erreurSurcharge() },
    ])
    const secours = secoursOpenAI()
    const { modele } = avecReprise(principal as never, {
      politique: SANS_ATTENTE,
      secours: { modele: secours as never, fournisseur: 'openai', modeleId: 'gpt-6.1-sol' },
    })
    const { morceaux } = await lireTout(modele)
    expect(textes(morceaux)).toEqual(['Début'])
    expect(types(morceaux)).toContain('error')
    expect(principal.doStreamCalls).toHaveLength(1)
    expect(secours.doStreamCalls).toHaveLength(0)
  })

  it('pas de bascule sans modèle de secours : l’erreur est rendue après les reprises', async () => {
    const principal = modeleSimule(() => etapeErreur())
    const { modele } = avecReprise(principal as never, { politique: SANS_ATTENTE })
    const { morceaux } = await lireTout(modele)
    expect(types(morceaux)).toContain('error')
    expect(principal.doStreamCalls).toHaveLength(3)
  })

  it('pas de bascule sur une erreur sans rapport avec la disponibilité (401)', async () => {
    const principal = modeleSimule(() => etapeErreur(erreurAuthentification()))
    const secours = secoursOpenAI()
    const { modele } = avecReprise(principal as never, {
      politique: SANS_ATTENTE,
      secours: { modele: secours as never, fournisseur: 'openai', modeleId: 'gpt-6.1-sol' },
    })
    const { morceaux } = await lireTout(modele)
    expect(types(morceaux)).toContain('error')
    expect(principal.doStreamCalls).toHaveLength(1)
    expect(secours.doStreamCalls).toHaveLength(0)
  })

  it('une seule bascule par étape : un secours lui-même surchargé rend son erreur', async () => {
    const principal = modeleSimule(() => etapeErreur())
    const secours = secoursOpenAI(() => etapeErreur())
    const { modele } = avecReprise(principal as never, {
      politique: SANS_ATTENTE,
      secours: { modele: secours as never, fournisseur: 'openai', modeleId: 'gpt-6.1-sol' },
    })
    const { morceaux } = await lireTout(modele)
    expect(types(morceaux)).toContain('error')
    expect(secours.doStreamCalls).toHaveLength(1)
  })

  it('les options propres à Anthropic ne partent pas chez un autre fournisseur', async () => {
    const principal = modeleSimule(() => etapeErreur())
    const secours = secoursOpenAI()
    const { modele } = avecReprise(principal as never, {
      politique: SANS_ATTENTE,
      secours: { modele: secours as never, fournisseur: 'openai', modeleId: 'gpt-6.1-sol' },
    })
    await lireTout(modele, {
      prompt: [
        {
          role: 'system',
          content: 'Règles',
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Question',
              providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } }, openai: { x: 1 } },
            },
          ],
        },
      ],
      maxOutputTokens: 32_000,
      providerOptions: { anthropic: { effort: 'high' } },
    })
    const envoye = secours.doStreamCalls[0] as unknown as Record<string, unknown>
    expect(envoye.providerOptions).toBeUndefined()
    expect(envoye.maxOutputTokens).toBeUndefined()
    const prompt = envoye.prompt as Array<Record<string, unknown>>
    expect(prompt[0].providerOptions).toBeUndefined()
    expect((prompt[1].content as Array<Record<string, unknown>>)[0].providerOptions).toEqual({
      openai: { x: 1 },
    })
    // Le principal a bien reçu ses options.
    expect((principal.doStreamCalls[0] as unknown as Record<string, unknown>).providerOptions).toEqual({
      anthropic: { effort: 'high' },
    })
  })

  it('secours Claude sans `effort` : option retirée, cache conservé', () => {
    const adapte = adapterParametresSecours(
      {
        prompt: [{ role: 'system', content: 'R', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }],
        maxOutputTokens: 32_000,
        providerOptions: { anthropic: { effort: 'high' } },
      },
      'anthropic',
      'claude-haiku-4-5'
    )
    expect(adapte.providerOptions).toBeUndefined()
    expect(adapte.maxOutputTokens).toBe(32_000)
    expect((adapte.prompt as Array<Record<string, unknown>>)[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    })
  })
})

describe('executerChat : modèle de secours et usage au bon modèle', () => {
  const contexte = contexteDe()

  beforeEach(() => {
    reinitialiserBase()
    h.outils = {}
    h.quota.mockResolvedValue({ autorise: true })
    h.lireConfig.mockResolvedValue(
      configDe({ modeleSecours: { fournisseur: 'openai', modele: 'gpt-6.1-sol' } })
    )
  })

  it('principal indisponible -> réponse du secours, usage et coût au modèle de secours', async () => {
    const principal = modeleSimule(() => etapeErreur())
    const secours = secoursOpenAI(() => etapeTexte('Réponse du secours'))
    const rapide = modeleSimule(() => etapeTexte('x'))
    h.creerModele.mockImplementation((fournisseur: string, modele: string) => {
      if (fournisseur === 'openai') return secours
      return modele === 'claude-haiku-5-5' ? rapide : principal
    })

    const resultat = await executerChat({ contexte, corps: corpsMessage('client-s') })
    const texte = await lireJusquauBout(resultat)
    expect(texte).toContain('Réponse du secours')
    expect(texte).not.toContain('medic_assist_erreur')
    expect(h.creerModele).toHaveBeenCalledWith('openai', 'gpt-6.1-sol')

    const usagesTour = tables.usages.filter(u => u.mode === 'standard')
    expect(usagesTour).toHaveLength(1)
    const usage = usagesTour[0]
    expect(usage).toMatchObject({ fournisseur: 'openai', modele: 'gpt-6.1-sol', erreur: null })
    const attendu = calculerCoutUsd('openai', 'gpt-6.1-sol', { entree: 1_000, sortie: 200 })
    expect(attendu).not.toBeNull()
    expect(usage.coutUsd).toBeCloseTo(attendu!, 10)

    const reponse = tables.messages.find(m => m.role === 'assistant')!
    expect(reponse.metadonnees).toMatchObject({ fournisseur: 'openai', modele: 'gpt-6.1-sol' })
    expect(console.warn).toHaveBeenCalledWith(
      '[datagenius] chat',
      expect.objectContaining({ reference: 'DG-TEST03', evenement: 'bascule_modele_secours' })
    )
  })

  it('étapes sur deux modèles -> une ligne d’usage par modèle, chacune à son tarif', async () => {
    h.outils = {
      outil_test: tool({
        description: 'Outil de test',
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      }),
    }
    // Étape 1 : le principal appelle l'outil. Étape 2 : le principal est indisponible.
    const principal = modeleSimule(n => (n === 1 ? etapeAppelOutil('outil_test') : etapeErreur()))
    const secours = secoursOpenAI(() =>
      etapeTexte('Synthèse', {
        inputTokens: { total: 3_000, noCache: 3_000, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 500, text: 500, reasoning: undefined },
      })
    )
    h.creerModele.mockImplementation((fournisseur: string, modele: string) =>
      fournisseur === 'openai' ? secours : modele === 'claude-haiku-5-5' ? modeleSimule(() => etapeTexte('t')) : principal
    )

    const resultat = await executerChat({ contexte, corps: corpsMessage('client-d') })
    await lireJusquauBout(resultat)

    const reponse = tables.messages.find(m => m.role === 'assistant')!
    const lignes = tables.usages.filter(u => u.mode === 'standard')
    expect(lignes.map(l => [l.fournisseur, l.modele, l.messageId])).toEqual([
      ['anthropic', 'claude-sonnet-5-5', reponse.id],
      ['openai', 'gpt-6.1-sol', reponse.id],
    ])
    expect(lignes[0].coutUsd).toBeCloseTo(
      calculerCoutUsd('anthropic', 'claude-sonnet-5-5', { entree: 1_000, sortie: 200 })!,
      10
    )
    expect(lignes[1].coutUsd).toBeCloseTo(
      calculerCoutUsd('openai', 'gpt-6.1-sol', { entree: 3_000, sortie: 500 })!,
      10
    )
    expect(lignes[1].dureeMs).toBe(0)
  })

  it('sans clé pour le secours : ignoré sans erreur, comportement inchangé', async () => {
    const { ErreurFournisseurAbsent } = await import('@/lib/medic-assist/config')
    const principal = modeleSimule(() => etapeTexte('Réponse principale'))
    h.creerModele.mockImplementation((fournisseur: string) => {
      if (fournisseur === 'openai') throw new ErreurFournisseurAbsent()
      return principal
    })
    const resultat = await executerChat({ contexte, corps: corpsMessage('client-k') })
    expect(await lireJusquauBout(resultat)).toContain('Réponse principale')
    expect(tables.usages.find(u => u.mode === 'standard')).toMatchObject({
      fournisseur: 'anthropic',
      modele: 'claude-sonnet-5-5',
    })
  })
})
