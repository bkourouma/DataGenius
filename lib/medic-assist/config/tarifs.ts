/**
 * Tarifs des modèles en USD par million de jetons, avec source et date de vérification.
 *
 * Une ligne absente signifie « tarif non confirmé » : le coût est alors inconnu (null)
 * et jamais estimé. Pour les fournisseurs sans surtaxe d'écriture de cache (OpenAI,
 * Google, DeepSeek), l'écriture de cache vaut le prix d'entrée (hypothèse).
 * Les tarifs DeepSeek varient selon l'heure : on retient le tarif de pointe (prudent).
 */

import type { Fournisseur, TarifAvecSource, TarifModele, UsageTokens } from './types'

// OpenAI : https://developers.openai.com/api/docs/pricing (verifie le 2026-11-02)
// Google : https://ai.google.dev/gemini-api/docs/pricing (verifie le 2026-11-02)
// DeepSeek : https://api-docs.deepseek.com/quick_start/pricing (verifie le 2026-11-02)
const SRC_ANTHROPIC = 'skill claude-api (prix Anthropic)'
const SRC_OPENAI = 'https://developers.openai.com/api/docs/pricing'
const SRC_GOOGLE = 'https://ai.google.dev/gemini-api/docs/pricing'
const SRC_DEEPSEEK = 'https://api-docs.deepseek.com/quick_start/pricing'

const NOTE_OPENAI = "Contexte court (jusqu'a 272K)."
const NOTE_GOOGLE_FLASH =
  "Tarif annonce valable jusqu'au 31/12/2026, double au 01/01/2027. Hors frais de stockage du cache."
const NOTE_DEEPSEEK = 'Tarif de pointe ; hors pointe, moitie moins cher.'

const LIGNES: Record<string, Omit<TarifAvecSource, 'fournisseur' | 'modele'>> = {
  'anthropic/claude-sonnet-5-5': {
    entreeUsdParMillion: 2,
    sortieUsdParMillion: 10,
    cacheLectureUsdParMillion: 0.2,
    cacheEcritureUsdParMillion: 2.5,
    source: SRC_ANTHROPIC,
    verifieLe: '2026-10-06',
    note: 'Ecriture de cache a 5 minutes.',
  },
  'anthropic/claude-opus-5-5': {
    entreeUsdParMillion: 4,
    sortieUsdParMillion: 20,
    cacheLectureUsdParMillion: 0.2,
    cacheEcritureUsdParMillion: 5,
    source: SRC_ANTHROPIC,
    verifieLe: '2026-10-06',
    note: 'Ecriture de cache a 5 minutes.',
  },
  'anthropic/claude-haiku-5-5': {
    entreeUsdParMillion: 0.1,
    sortieUsdParMillion: 0.5,
    cacheLectureUsdParMillion: 0.01,
    cacheEcritureUsdParMillion: 0.125,
    source: SRC_ANTHROPIC,
    verifieLe: '2026-10-06',
    note: "Jusqu'a 100K de prompt. Lecture/ecriture de cache = 10 % / 125 % du prix d'entree (hypothese).",
  },
  'openai/gpt-6.1-sol': {
    entreeUsdParMillion: 2,
    sortieUsdParMillion: 10,
    cacheLectureUsdParMillion: 0.1,
    cacheEcritureUsdParMillion: 2,
    source: SRC_OPENAI,
    verifieLe: '2026-11-02',
    note: NOTE_OPENAI,
  },
  'openai/gpt-6.1-terra': {
    entreeUsdParMillion: 1,
    sortieUsdParMillion: 5,
    cacheLectureUsdParMillion: 0.05,
    cacheEcritureUsdParMillion: 1,
    source: SRC_OPENAI,
    verifieLe: '2026-11-02',
    note: NOTE_OPENAI,
  },
  'openai/gpt-6-astra': {
    entreeUsdParMillion: 10,
    sortieUsdParMillion: 50,
    cacheLectureUsdParMillion: 1,
    cacheEcritureUsdParMillion: 10,
    source: SRC_OPENAI,
    verifieLe: '2026-11-02',
    note: NOTE_OPENAI,
  },
  'openai/gpt-6-luna': {
    entreeUsdParMillion: 0.1,
    sortieUsdParMillion: 0.5,
    cacheLectureUsdParMillion: 0.01,
    cacheEcritureUsdParMillion: 0.1,
    source: SRC_OPENAI,
    verifieLe: '2026-11-02',
    note: NOTE_OPENAI,
  },
  'google/gemini-4-argon': {
    entreeUsdParMillion: 2,
    sortieUsdParMillion: 10,
    cacheLectureUsdParMillion: 0.1,
    cacheEcritureUsdParMillion: 2,
    source: SRC_GOOGLE,
    verifieLe: '2026-11-02',
    note: "Tarif annonce valable jusqu'au 30/11/2026, double au 01/12/2026 (4 / 20 / 0,20). Cache implicite seulement.",
  },
  'google/gemini-3.8-flash': {
    entreeUsdParMillion: 0.75,
    sortieUsdParMillion: 3.75,
    cacheLectureUsdParMillion: 0.075,
    cacheEcritureUsdParMillion: 0.75,
    source: SRC_GOOGLE,
    verifieLe: '2026-11-02',
    note: NOTE_GOOGLE_FLASH,
  },
  'google/gemini-3.6-flash': {
    entreeUsdParMillion: 0.75,
    sortieUsdParMillion: 3.75,
    cacheLectureUsdParMillion: 0.075,
    cacheEcritureUsdParMillion: 0.75,
    source: SRC_GOOGLE,
    verifieLe: '2026-11-02',
    note: NOTE_GOOGLE_FLASH,
  },
  'google/gemini-3.1-flash-lite': {
    entreeUsdParMillion: 0.25,
    sortieUsdParMillion: 1.5,
    cacheLectureUsdParMillion: 0.025,
    cacheEcritureUsdParMillion: 0.25,
    source: SRC_GOOGLE,
    verifieLe: '2026-11-02',
    note: 'Hors frais de stockage du cache.',
  },
  'deepseek/deepseek-flash': {
    entreeUsdParMillion: 0.3,
    sortieUsdParMillion: 1.2,
    cacheLectureUsdParMillion: 0.006,
    cacheEcritureUsdParMillion: 0.3,
    source: SRC_DEEPSEEK,
    verifieLe: '2026-11-02',
    note: NOTE_DEEPSEEK,
  },
  'deepseek/deepseek-v4-pro': {
    entreeUsdParMillion: 1.32,
    sortieUsdParMillion: 3.96,
    cacheLectureUsdParMillion: 0.044,
    cacheEcritureUsdParMillion: 1.32,
    source: SRC_DEEPSEEK,
    verifieLe: '2026-11-02',
    note: NOTE_DEEPSEEK,
  },
}

/** Tarifs avec source et date, indexés par `fournisseur/modèle`. */
export const TARIFS_AVEC_SOURCE: Record<string, TarifAvecSource> = Object.fromEntries(
  Object.entries(LIGNES).map(([cle, ligne]) => {
    const [fournisseur, ...reste] = cle.split('/')
    return [cle, { ...ligne, fournisseur: fournisseur as Fournisseur, modele: reste.join('/') }]
  })
)

function sansSource(tarif: TarifAvecSource): TarifModele {
  return {
    fournisseur: tarif.fournisseur,
    modele: tarif.modele,
    entreeUsdParMillion: tarif.entreeUsdParMillion,
    sortieUsdParMillion: tarif.sortieUsdParMillion,
    cacheLectureUsdParMillion: tarif.cacheLectureUsdParMillion,
    cacheEcritureUsdParMillion: tarif.cacheEcritureUsdParMillion,
  }
}

/** Tarif du contrat (sans source), `null` si le modèle n'est pas tarifé. */
export function tarifModele(fournisseur: Fournisseur, modele: string): TarifModele | null {
  const tarif = TARIFS_AVEC_SOURCE[`${fournisseur}/${modele}`]
  return tarif ? sansSource(tarif) : null
}

/** Tous les tarifs connus (pour `ConfigAdminDto.tarifs`). */
export function tarifsConnus(): TarifModele[] {
  return Object.values(TARIFS_AVEC_SOURCE).map(sansSource)
}

/**
 * Coût en USD arrondi à 6 décimales, `null` si le tarif du modèle est inconnu.
 * `usage.entree` est le TOTAL des jetons d'entrée, cache compris ; le raisonnement est
 * déjà dans `usage.sortie`. Sans tarif de cache, les jetons de cache sont facturés au
 * prix d'entrée.
 */
export function calculerCoutUsd(
  fournisseur: Fournisseur,
  modele: string,
  usage: UsageTokens
): number | null {
  const tarif = tarifModele(fournisseur, modele)
  if (!tarif) return null

  const lecture = Math.max(0, usage.cacheLecture ?? 0)
  const ecriture = Math.max(0, usage.cacheEcriture ?? 0)
  const entreeSimple = Math.max(0, usage.entree - lecture - ecriture)
  const prixLecture = tarif.cacheLectureUsdParMillion ?? tarif.entreeUsdParMillion
  const prixEcriture = tarif.cacheEcritureUsdParMillion ?? tarif.entreeUsdParMillion

  const cout =
    (entreeSimple * tarif.entreeUsdParMillion +
      lecture * prixLecture +
      ecriture * prixEcriture +
      usage.sortie * tarif.sortieUsdParMillion) /
    1_000_000

  return Math.round(cout * 1_000_000) / 1_000_000
}
