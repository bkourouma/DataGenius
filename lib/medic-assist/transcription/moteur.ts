/**
 * Choix du moteur de dictee envoyee au serveur.
 *
 * Piloté UNIQUEMENT par `config.transcription` ({ fournisseur, modele } | null) :
 * - null : dictee du navigateur seulement, la route repond 503 `transcriptionIndisponible` ;
 * - fournisseur configure sans cle sur le serveur : 503 aussi (pas de repli silencieux).
 * Seule la PRESENCE de la cle est lue, jamais sa valeur au-dela du test « non vide ».
 */

import {
  VARIABLES_CLES_FOURNISSEURS,
  type ConfigTranscription,
  type FournisseurTranscription,
} from '../admin/imports-lot0-lot1'

type Environnement = Record<string, string | undefined>

export type MoteurTranscription = { fournisseur: FournisseurTranscription; modele: string }

export function cleTranscriptionPresente(
  fournisseur: FournisseurTranscription,
  env: Environnement = process.env
): boolean {
  return (env[VARIABLES_CLES_FOURNISSEURS[fournisseur]] ?? '').trim().length > 0
}

/** Moteur effectivement utilisable, ou null si la dictee serveur est indisponible. */
export function moteurTranscriptionEffectif(
  transcription: ConfigTranscription,
  env: Environnement = process.env
): MoteurTranscription | null {
  if (!transcription) return null
  return cleTranscriptionPresente(transcription.fournisseur, env) ? transcription : null
}
