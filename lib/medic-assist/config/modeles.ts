/**
 * Fabrique des modèles de langage du SDK IA (Vercel AI SDK 7).
 *
 * La clé est lue dans `env` (process.env par défaut) sous le nom fixé par le contrat
 * (`VARIABLES_CLES_FOURNISSEURS`) et transmise au seul constructeur du fournisseur. Elle
 * n'est jamais journalisée ni mise dans un message d'erreur.
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { VARIABLES_CLES_FOURNISSEURS } from '@/lib/medic-assist/contrats'
import { ErreurFournisseurAbsent, type Fournisseur } from './types'

type Env = Record<string, string | undefined>

/**
 * Modèle de langage prêt pour `streamText({ model })`.
 * Lève `ErreurFournisseurAbsent` si la clé du fournisseur manque ou est vide.
 */
export function creerModele(
  fournisseur: Fournisseur,
  modeleId: string,
  env: Env = process.env
): LanguageModel {
  const apiKey = env[VARIABLES_CLES_FOURNISSEURS[fournisseur]]?.trim()
  if (!apiKey) throw new ErreurFournisseurAbsent()

  switch (fournisseur) {
    case 'anthropic':
      return createAnthropic({ apiKey })(modeleId)
    case 'openai':
      return createOpenAI({ apiKey })(modeleId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modeleId)
    case 'deepseek':
      return createDeepSeek({ apiKey })(modeleId)
  }
}

/**
 * `providerOptions` à poser sur la partie statique du prompt système. Seul Anthropic
 * demande un point de cache explicite ; chez les autres le cache est automatique.
 */
export function optionsCachePrompt(
  fournisseur: Fournisseur
): { anthropic: { cacheControl: { type: 'ephemeral' } } } | undefined {
  return fournisseur === 'anthropic'
    ? { anthropic: { cacheControl: { type: 'ephemeral' } } }
    : undefined
}
