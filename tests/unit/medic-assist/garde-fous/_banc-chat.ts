/**
 * Outils communs des tests des garde-fous du chat : contexte, configuration, modèles simulés
 * (`MockLanguageModelV4` de 'ai/test') et lecture d'un résultat de `executerChat`.
 * Les `vi.mock` restent dans chaque fichier de test (ils sont remontés par vitest).
 */
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import type { ConfigEffective } from '@/lib/medic-assist/config'
import type { ResultatChat } from '@/lib/medic-assist/agent/executer'

export type Morceau = Record<string, unknown>

export const USAGE_ETAPE = {
  inputTokens: { total: 1_000, noCache: 1_000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 200, text: 200, reasoning: undefined },
}

export const UTILISATEUR = 'utilisateur-1'

export function contexteDe(userId = UTILISATEUR): ContexteExecution {
  return {
    userId,
    roleName: 'Member',
    scope: { roleName: 'Member', voitTout: true },
    habilitations: null,
    locale: 'fr',
    maintenant: new Date('2026-11-13T09:00:00Z'),
    jourLimite: 1,
  } as ContexteExecution
}

export function configDe(extra: Partial<ConfigEffective> = {}): ConfigEffective {
  return {
    fournisseur: 'anthropic',
    modeles: {
      standard: 'claude-sonnet-5-5',
      profond: 'claude-opus-5-5',
      rapide: 'claude-haiku-5-5',
    },
    transcription: null,
    plafondCoutJournalierUsd: 10,
    modeleSecours: null,
    repliSurClaude: false,
    fournisseurDemande: 'anthropic',
    ...extra,
  } as ConfigEffective
}

export function etapeTexte(texte: string, usage = USAGE_ETAPE): Morceau[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: texte },
    { type: 'text-end', id: 't1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage },
  ]
}

export function etapeAppelOutil(nom: string, usage = USAGE_ETAPE): Morceau[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'appel-1', toolName: nom, input: '{}' },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
  ]
}

/** Surcharge Anthropic (529 `overloaded_error`) : indisponibilité, réessayable. */
export function erreurSurcharge(): Record<string, unknown> {
  return {
    name: 'APICallError',
    statusCode: 529,
    message: 'Overloaded',
    responseBody: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
  }
}

/** Clé refusée (401) : configuration, jamais une cause de bascule. */
export function erreurAuthentification(): Record<string, unknown> {
  return {
    name: 'APICallError',
    statusCode: 401,
    message: 'invalid x-api-key',
    responseBody: '{"type":"error","error":{"type":"authentication_error","message":"invalid"}}',
  }
}

export function etapeErreur(erreur: unknown = erreurSurcharge()): Morceau[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'error', error: erreur },
  ]
}

export function flux(morceaux: Morceau[]): { stream: ReadableStream<Morceau> } {
  return { stream: convertArrayToReadableStream(morceaux as never[]) as never }
}

/** Modèle simulé dont chaque appel à doStream est fourni par `etape(n)` (n à partir de 1). */
export function modeleSimule(
  etape: (n: number, options: unknown) => Morceau[] | Promise<Morceau[]>,
  provider = 'anthropic.messages',
  modelId = 'claude-sonnet-5-5'
): MockLanguageModelV4 {
  let n = 0
  return new MockLanguageModelV4({
    provider,
    modelId,
    doStream: (async (options: unknown) => {
      n += 1
      return flux(await etape(n, options))
    }) as never,
    doGenerate: (async () => ({
      content: [{ type: 'text', text: 'Titre de test' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: USAGE_ETAPE,
      warnings: [],
    })) as never,
  })
}

export function corpsMessage(
  idClient: string,
  extra: Record<string, unknown> = {},
  texte = 'Quel est le total des ventes ?'
): Record<string, unknown> {
  return {
    message: { id: idClient, role: 'user', parts: [{ type: 'text', text: texte }] },
    ...extra,
  }
}

/** Lit le flux jusqu'au bout (la fin de tour, onEnd, est alors terminée). */
export async function lireJusquauBout(resultat: ResultatChat): Promise<string> {
  if (resultat.type !== 'flux') throw new Error(`flux attendu : ${JSON.stringify(resultat)}`)
  return resultat.reponse.text()
}

export function promesseControlee(): { promesse: Promise<void>; liberer: () => void } {
  let liberer: () => void = () => undefined
  const promesse = new Promise<void>(r => {
    liberer = r
  })
  return { promesse, liberer }
}
