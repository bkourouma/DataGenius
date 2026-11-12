/**
 * Registre des fournisseurs de modeles : libelle, variable d'environnement de la cle,
 * modeles par defaut par mode et modeles proposes a l'administrateur.
 *
 * Les identifiants viennent des documentations officielles (verification du 02/11/2026).
 * Les cles API ne vivent que dans l'environnement : ici on ne manipule que des booleens.
 */

import {
  FOURNISSEURS,
  MODELES_CLAUDE_PAR_DEFAUT,
  VARIABLES_CLES_FOURNISSEURS,
} from '@/lib/medic-assist/contrats'
import type { Fournisseur, ModeLangage } from './types'

export interface ModelePropose {
  id: string
  /** Nom propre du modele, identique dans toutes les langues. */
  libelle: string
}

export interface FicheFournisseur {
  id: Fournisseur
  /** Nom propre du fournisseur, identique dans toutes les langues. */
  libelle: string
  variableCle: string
  modelesParDefaut: Record<ModeLangage, string>
  modelesProposes: ModelePropose[]
}

export const REGISTRE_FOURNISSEURS: Record<Fournisseur, FicheFournisseur> = {
  anthropic: {
    id: 'anthropic',
    libelle: 'Anthropic',
    variableCle: VARIABLES_CLES_FOURNISSEURS.anthropic,
    modelesParDefaut: { ...MODELES_CLAUDE_PAR_DEFAUT },
    modelesProposes: [
      { id: 'claude-sonnet-5-5', libelle: 'Claude Sonnet 5.5' },
      { id: 'claude-opus-5-5', libelle: 'Claude Opus 5.5' },
      { id: 'claude-haiku-5-5', libelle: 'Claude Haiku 5.5' },
    ],
  },
  openai: {
    id: 'openai',
    libelle: 'OpenAI',
    variableCle: VARIABLES_CLES_FOURNISSEURS.openai,
    // Source : https://developers.openai.com/api/docs/models (02/11/2026).
    modelesParDefaut: {
      standard: 'gpt-6.1-sol',
      profond: 'gpt-6-astra',
      rapide: 'gpt-6-luna',
    },
    modelesProposes: [
      { id: 'gpt-6.1-sol', libelle: 'GPT-6.1 Sol' },
      { id: 'gpt-6.1-terra', libelle: 'GPT-6.1 Terra' },
      { id: 'gpt-6-astra', libelle: 'GPT-6 Astra' },
      { id: 'gpt-6-luna', libelle: 'GPT-6 Luna' },
    ],
  },
  google: {
    id: 'google',
    libelle: 'Google',
    variableCle: VARIABLES_CLES_FOURNISSEURS.google,
    // Source : https://ai.google.dev/gemini-api/docs/models (02/11/2026).
    modelesParDefaut: {
      standard: 'gemini-3.8-flash',
      profond: 'gemini-4-argon',
      rapide: 'gemini-3.1-flash-lite',
    },
    modelesProposes: [
      { id: 'gemini-4-argon', libelle: 'Gemini 4 Argon' },
      { id: 'gemini-3.8-flash', libelle: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.6-flash', libelle: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.1-flash-lite', libelle: 'Gemini 3.1 Flash-Lite' },
    ],
  },
  deepseek: {
    id: 'deepseek',
    libelle: 'DeepSeek',
    variableCle: VARIABLES_CLES_FOURNISSEURS.deepseek,
    // Source : https://api-docs.deepseek.com/quick_start/pricing (02/11/2026).
    modelesParDefaut: {
      standard: 'deepseek-flash',
      profond: 'deepseek-v4-pro',
      rapide: 'deepseek-flash',
    },
    modelesProposes: [
      { id: 'deepseek-flash', libelle: 'DeepSeek Flash' },
      { id: 'deepseek-v4-pro', libelle: 'DeepSeek V4 Pro' },
    ],
  },
}

export function estFournisseur(valeur: unknown): valeur is Fournisseur {
  return typeof valeur === 'string' && (FOURNISSEURS as readonly string[]).includes(valeur)
}

/**
 * Un fournisseur est disponible si sa cle existe dans l'environnement et n'est pas
 * vide. Renvoie un booleen : la valeur de la cle ne sort jamais de cette fonction.
 */
export function fournisseurDisponible(
  fournisseur: Fournisseur,
  env: Record<string, string | undefined> = process.env
): boolean {
  const valeur = env[REGISTRE_FOURNISSEURS[fournisseur].variableCle]
  return typeof valeur === 'string' && valeur.trim() !== ''
}

/**
 * Modèles par défaut. Avec un fournisseur : ceux de ce fournisseur. Sans argument : la
 * table complète au format de `ConfigAdminDto.modelesParDefaut`. Les défauts non-Claude
 * sont fixés ici (le contrat les laisse à null) : aucun mode n'est donc à null.
 */
export function modelesParDefaut(fournisseur: Fournisseur): Record<ModeLangage, string>
export function modelesParDefaut(): Record<Fournisseur, Record<ModeLangage, string | null>>
export function modelesParDefaut(
  fournisseur?: Fournisseur
): Record<ModeLangage, string> | Record<Fournisseur, Record<ModeLangage, string | null>> {
  if (fournisseur) return { ...REGISTRE_FOURNISSEURS[fournisseur].modelesParDefaut }
  return Object.fromEntries(
    FOURNISSEURS.map(f => [f, { ...REGISTRE_FOURNISSEURS[f].modelesParDefaut }])
  ) as Record<Fournisseur, Record<ModeLangage, string | null>>
}
