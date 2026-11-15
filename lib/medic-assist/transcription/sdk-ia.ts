/**
 * Chargement du SDK IA par import dynamique : UN seul module du lot 6 le touche pour la
 * transcription (le test de modele passe par `creerModele` de dependances). Les tests
 * le remplacent par un faux (vi.mock de ce module, ou injection d'un `SdkIa`).
 *
 * API verifiee dans node_modules (ai 7.0.159, @ai-sdk/openai 4.0.106, @ai-sdk/google 4.0.109) :
 *   - `transcribe({ model, audio, providerOptions, abortSignal, maxRetries })` de `ai`
 *     -> `{ text, segments, language, durationInSeconds, warnings, responses, providerMetadata }`
 *     (`experimental_transcribe` n'est qu'un alias) ; AUCUN usage en jetons ;
 *   - `openai.transcription(modelId)` et `google.transcription(modelId)` -> TranscriptionModelV4 ;
 *   - `generateText({ model, messages | prompt, maxOutputTokens, abortSignal, maxRetries })`
 *     -> `{ text, usage: { inputTokens, outputTokens, ... } }`.
 */

export interface UsageSdk {
  inputTokens?: number
  outputTokens?: number
}

export interface ResultatTranscribeSdk {
  text: string
  language?: string
  durationInSeconds?: number
}

export interface SdkIa {
  transcribe(options: {
    model: unknown
    audio: Uint8Array
    providerOptions?: Record<string, Record<string, string | string[]>>
    abortSignal?: AbortSignal
    maxRetries?: number
  }): Promise<ResultatTranscribeSdk>
  generateText(options: {
    model: unknown
    prompt?: string
    messages?: unknown[]
    maxOutputTokens?: number
    abortSignal?: AbortSignal
    maxRetries?: number
  }): Promise<{ text: string; usage?: UsageSdk }>
  /** openai.transcription(modele) */
  modeleTranscriptionOpenai(modele: string): unknown
  /** google.transcription(modele) */
  modeleTranscriptionGoogle(modele: string): unknown
  /** google(modele) : modele de langage, pour la transcription par generateText. */
  modeleGoogle(modele: string): unknown
}

let enCache: Promise<SdkIa> | null = null

export function chargerSdkIa(): Promise<SdkIa> {
  if (!enCache) {
    enCache = (async () => {
      const [ai, openaiModule, googleModule] = await Promise.all([
        import('ai'),
        import('@ai-sdk/openai'),
        import('@ai-sdk/google'),
      ])
      type OptionsTranscribe = Parameters<typeof ai.transcribe>[0]
      type OptionsGenerer = Parameters<typeof ai.generateText>[0]
      const sdk: SdkIa = {
        transcribe: async options => {
          const r = await ai.transcribe({
            ...options,
            model: options.model as OptionsTranscribe['model'],
          })
          return { text: r.text, language: r.language, durationInSeconds: r.durationInSeconds }
        },
        generateText: async options => {
          const r = await ai.generateText({
            ...options,
            model: options.model as OptionsGenerer['model'],
          } as OptionsGenerer)
          return { text: r.text, usage: r.usage }
        },
        modeleTranscriptionOpenai: modele => openaiModule.openai.transcription(modele),
        modeleTranscriptionGoogle: modele => googleModule.google.transcription(modele),
        modeleGoogle: modele => googleModule.google(modele),
      }
      return sdk
    })().catch(erreur => {
      enCache = null
      throw erreur
    })
  }
  return enCache
}
