/**
 * Reprise automatique bornée par étape (lib/medic-assist/agent/reprise.ts).
 * Modèle simulé `MockLanguageModelV4` de 'ai/test' ; attentes factices.
 */
import { describe, expect, it, vi } from 'vitest'
import { APICallError } from 'ai'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import {
  POLITIQUE_REPRISE_DEFAUT,
  avecReprise,
  erreurReessayable,
  type PolitiqueReprise,
} from '@/lib/medic-assist/agent/reprise'

// Marqueur de test : ZZMA1REP

type Morceau = Record<string, unknown>

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

function etapeTexte(texte: string): Morceau[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: texte },
    { type: 'text-end', id: 't1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: USAGE },
  ]
}

function erreurSurcharge(): Record<string, unknown> {
  return {
    name: 'APICallError',
    statusCode: 529,
    message: 'Overloaded',
    responseBody: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
  }
}

/** Flux qui échoue avant tout contenu. */
function etapeErreur(erreur: unknown = erreurSurcharge()): Morceau[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'error', error: erreur },
  ]
}

type Resultat = { stream: ReadableStream<Morceau> } | { type: 'throw'; error: unknown }

function modele(...resultats: Resultat[]) {
  return new MockLanguageModelV4({
    provider: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    doStream: resultats.map(r => r) as never,
  })
}

function fluxDe(chunks: Morceau[]): Resultat {
  return { stream: convertArrayToReadableStream(chunks as never[]) as never }
}

function politique(extra: Partial<PolitiqueReprise> = {}) {
  const attentes: number[] = []
  const journal: string[] = []
  const p: PolitiqueReprise = {
    delaisMs: [2_000, 4_000, 8_000],
    gigue: 0,
    attendre: async ms => {
      attentes.push(ms)
    },
    journaliser: m => journal.push(m),
    ...extra,
  }
  return { p, attentes, journal }
}

async function lireTout(
  m: ReturnType<typeof avecReprise>['modele']
): Promise<{ morceaux: Morceau[]; erreur?: unknown }> {
  const resultat = await (
    m as unknown as { doStream: (o: unknown) => Promise<{ stream: ReadableStream<Morceau> }> }
  ).doStream({ prompt: [] })
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

describe('avecReprise : erreur en flux avant tout contenu', () => {
  it('529 puis succès : le consommateur ne voit que le succès, une attente de 2000 ms', async () => {
    const mock = modele(fluxDe(etapeErreur()), fluxDe(etapeTexte('Bonjour')))
    const { p, attentes, journal } = politique()
    const { modele: enveloppe } = avecReprise(mock as never, { politique: p })

    const { morceaux, erreur } = await lireTout(enveloppe)

    expect(erreur).toBeUndefined()
    expect(types(morceaux)).not.toContain('error')
    expect(types(morceaux)).toEqual([
      'stream-start',
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ])
    expect(attentes).toEqual([2_000])
    expect(mock.doStreamCalls).toHaveLength(2)
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatch(
      /^\[medic-assist\/chat\] reprise 1\/3 dans 2000 ms : code=fournisseur_indisponible/
    )
    expect(journal[0]).toContain('typeFournisseur=overloaded_error')
  })

  it('erreur persistante : 3 reprises (2000/4000/8000) puis l’erreur est transmise', async () => {
    const mock = modele(
      fluxDe(etapeErreur()),
      fluxDe(etapeErreur()),
      fluxDe(etapeErreur()),
      fluxDe(etapeErreur())
    )
    const { p, attentes } = politique()
    const { modele: enveloppe } = avecReprise(mock as never, { politique: p })

    const { morceaux, erreur } = await lireTout(enveloppe)

    expect(erreur).toBeUndefined()
    expect(attentes).toEqual([2_000, 4_000, 8_000])
    expect(mock.doStreamCalls).toHaveLength(4)
    expect(types(morceaux)).toEqual(['stream-start', 'error'])
    expect((morceaux[1] as { error: { statusCode: number } }).error.statusCode).toBe(529)
  })

  it.each([
    [
      '400 invalid_request_error',
      {
        name: 'APICallError',
        statusCode: 400,
        message: 'overloaded',
        responseBody:
          '{"type":"error","error":{"type":"invalid_request_error","message":"tools.0 overloaded"}}',
      },
    ],
    ['401', { name: 'APICallError', statusCode: 401, message: 'invalid x-api-key' }],
  ])('erreur non réessayable (%s) : aucune reprise', async (_nom, erreurApi) => {
    const mock = modele(fluxDe(etapeErreur(erreurApi)), fluxDe(etapeTexte('jamais')))
    const { p, attentes } = politique()
    const { modele: enveloppe } = avecReprise(mock as never, { politique: p })

    const { morceaux } = await lireTout(enveloppe)

    expect(attentes).toEqual([])
    expect(mock.doStreamCalls).toHaveLength(1)
    expect(types(morceaux)).toEqual(['stream-start', 'error'])
  })

  it('erreur après du contenu déjà transmis : aucune reprise', async () => {
    const mock = modele(
      fluxDe([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Début' },
        { type: 'error', error: erreurSurcharge() },
      ]),
      fluxDe(etapeTexte('jamais'))
    )
    const { p, attentes } = politique()
    const { modele: enveloppe } = avecReprise(mock as never, { politique: p })

    const { morceaux, erreur } = await lireTout(enveloppe)

    expect(erreur).toBeUndefined()
    expect(attentes).toEqual([])
    expect(mock.doStreamCalls).toHaveLength(1)
    expect(types(morceaux)).toEqual(['stream-start', 'text-start', 'text-delta', 'error'])
  })
})

describe('avecReprise : doStream qui lève', () => {
  it('APICallError 503 retentable puis succès', async () => {
    const erreur503 = new APICallError({
      message: 'Service Unavailable',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
    })
    let appels = 0
    const mock = new MockLanguageModelV4({
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      doStream: async () => {
        appels += 1
        if (appels === 1) throw erreur503
        return fluxDe(etapeTexte('Reprise réussie')) as never
      },
    })
    const { p, attentes, journal } = politique()
    const { modele: enveloppe } = avecReprise(mock as never, { politique: p })

    const { morceaux, erreur } = await lireTout(enveloppe)

    expect(erreur).toBeUndefined()
    expect(attentes).toEqual([2_000])
    expect(types(morceaux)).toContain('finish')
    expect(journal[0]).toContain('statut=503')
    expect(journal[0]).not.toContain('api.anthropic.com')
  })

  it('erreur levée non réessayable : relancée telle quelle', async () => {
    const erreur401 = { name: 'APICallError', statusCode: 401, message: 'nope' }
    const mock = new MockLanguageModelV4({
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      doStream: async () => {
        throw erreur401
      },
    })
    const { p, attentes } = politique()
    const { modele: enveloppe } = avecReprise(mock as never, { politique: p })

    await expect(lireTout(enveloppe)).rejects.toBe(erreur401)
    expect(attentes).toEqual([])
  })
})

describe('avecReprise : signal annulé', () => {
  it('annulation pendant l’attente : pas de nouvel essai', async () => {
    const controleur = new AbortController()
    const mock = modele(fluxDe(etapeErreur()), fluxDe(etapeTexte('jamais')))
    const attendre = vi.fn(async (_ms: number, signal?: AbortSignal) => {
      controleur.abort()
      if (signal?.aborted) throw Object.assign(new Error('annulé'), { name: 'AbortError' })
    })
    const { p } = politique({ attendre })
    const { modele: enveloppe } = avecReprise(mock as never, {
      signal: controleur.signal,
      politique: p,
    })

    await expect(lireTout(enveloppe)).rejects.toMatchObject({ name: 'AbortError' })
    expect(attendre).toHaveBeenCalledTimes(1)
    expect(mock.doStreamCalls).toHaveLength(1)
  })

  it('signal déjà annulé : l’erreur est transmise sans reprise ni attente', async () => {
    const controleur = new AbortController()
    controleur.abort()
    const mock = modele(fluxDe(etapeErreur()), fluxDe(etapeTexte('jamais')))
    const { p, attentes } = politique()
    const { modele: enveloppe } = avecReprise(mock as never, {
      signal: controleur.signal,
      politique: p,
    })

    const { morceaux } = await lireTout(enveloppe)
    expect(attentes).toEqual([])
    expect(mock.doStreamCalls).toHaveLength(1)
    expect(types(morceaux)).toEqual(['stream-start', 'error'])
  })

  it('l’attente par défaut rejette quand le signal est annulé', async () => {
    const controleur = new AbortController()
    const mock = modele(fluxDe(etapeErreur()), fluxDe(etapeTexte('jamais')))
    const { modele: enveloppe } = avecReprise(mock as never, {
      signal: controleur.signal,
      politique: { delaisMs: [60_000], gigue: 0, journaliser: () => undefined },
    })
    const lecture = lireTout(enveloppe)
    setTimeout(() => controleur.abort(), 10)
    await expect(lecture).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.doStreamCalls).toHaveLength(1)
  })
})

describe('avecReprise : réglage du SDK', () => {
  it('maxRetriesSdk vaut 0 pour un modèle V4 et undefined pour un objet non V4', () => {
    const v4 = modele(fluxDe(etapeTexte('x')))
    expect(avecReprise(v4 as never).maxRetriesSdk).toBe(0)
    expect(avecReprise(v4 as never).modele).not.toBe(v4)

    const ancien = { specificationVersion: 'v2', modelId: 'm', provider: 'p' }
    const rendu = avecReprise(ancien as never)
    expect(rendu.maxRetriesSdk).toBeUndefined()
    expect(rendu.modele).toBe(ancien)

    expect(avecReprise('claude-sonnet-5-5').maxRetriesSdk).toBeUndefined()
  })

  it('politique par défaut : 2 s, 4 s, 8 s', () => {
    expect(POLITIQUE_REPRISE_DEFAUT.delaisMs).toEqual([2_000, 4_000, 8_000])
  })

  it('la gigue ajoute au plus sa part à l’attente', async () => {
    const mock = modele(fluxDe(etapeErreur()), fluxDe(etapeTexte('ok')))
    const { p, attentes } = politique({ gigue: 0.25 })
    const { modele: enveloppe } = avecReprise(mock as never, { politique: p })
    await lireTout(enveloppe)
    expect(attentes[0]).toBeGreaterThanOrEqual(2_000)
    expect(attentes[0]).toBeLessThanOrEqual(2_500)
  })
})

describe('erreurReessayable', () => {
  const api = (statusCode: number, message = 'x') => ({
    name: 'APICallError',
    statusCode,
    message,
  })

  it('oui : fournisseur_indisponible, limite_debit, 5xx', () => {
    expect(erreurReessayable(api(529, 'Overloaded'))).toBe(true)
    expect(erreurReessayable(api(503))).toBe(true)
    expect(erreurReessayable(api(429))).toBe(true)
    expect(erreurReessayable(api(500))).toBe(true)
    expect(erreurReessayable(new TypeError('fetch failed'))).toBe(true)
    expect(
      erreurReessayable({
        type: 'error',
        error: { type: 'overloaded_error', message: 'Overloaded' },
      })
    ).toBe(true)
  })

  it('non : délai, quota, authentification, annulation, interne', () => {
    expect(erreurReessayable(api(504))).toBe(false)
    expect(erreurReessayable(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe(false)
    expect(erreurReessayable(api(402))).toBe(false)
    expect(erreurReessayable(api(429, 'You exceeded your current quota'))).toBe(false)
    expect(erreurReessayable(api(401))).toBe(false)
    expect(erreurReessayable(Object.assign(new Error('a'), { name: 'AbortError' }))).toBe(false)
    expect(erreurReessayable(api(400, 'overloaded'))).toBe(false)
    expect(erreurReessayable(new Error('quelque chose'))).toBe(false)
  })
})
