/**
 * Types internes de la couche de donnees (lot 2), hors contrats partages.
 */

import type { ColonneJeu, Provenance } from '@/lib/medic-assist/contrats'
import type { RequeteSemantique } from '@/lib/medic-assist/donnees/requete-interne'

/** Nombre maximal de lignes gardees en cache dans un jeu (architecture §3). */
export const MAX_LIGNES_JEU = 10_000
/** Nombre maximal de lignes d'un export complet (architecture §3). */
export const MAX_LIGNES_EXPORT = 100_000
/** Taille de l'apercu renvoye a l'IA. */
export const TAILLE_APERCU = 30
/** Delai maximal d'une requete SQL (ms). */
export const DELAI_SQL_MS = 15_000

/** Specification REJOUABLE d'un jeu : stockee, puis rejouee avec le perimetre de chaque lecteur. */
export type SpecJeu =
  | { type: 'semantique'; requete: RequeteSemantique }
  | { type: 'sql'; sql: string; objectif: string }

/**
 * Resultat brut d'un calcul, avant enregistrement en jeu de donnees.
 * `lignes` contient au plus `limite` lignes (10 000 pour le cache, 100 000 pour l'export).
 */
export interface ResultatCalcule {
  empreinteSource: string
  colonnesNonAdditives?: ReadonlySet<string>
  colonnes: ColonneJeu[]
  lignes: Record<string, unknown>[]
  /** Vrai si le resultat complet depasse `lignes` (limite atteinte). */
  tronque: boolean
  totaux?: Record<string, number>
  provenance: Provenance
}

/** Options de calcul communes au moteur semantique et au SQL controle. */
export interface OptionsCalcul {
  /** Nombre maximal de lignes a renvoyer (defaut MAX_LIGNES_JEU). */
  limiteLignes?: number
}

/**
 * Erreur destinee au MODELE : le message est court, exploitable (dit quoi corriger, liste les
 * valeurs possibles) et ne divulgue ni schema, ni identifiant technique, ni trace.
 */
export class ErreurDonnees extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'jeu_inconnu'
      | 'mesure_inconnue'
      | 'dimension_inconnue'
      | 'filtre_inconnu'
      | 'filtre_invalide'
      | 'periode_invalide'
      | 'requete_invalide'
      | 'sql_interdit'
      | 'sql_erreur'
      | 'sql_delai'
      | 'jeu_non_rejouable'
      | 'introuvable'
      | 'acces_refuse'
      | 'role_lecture_absent'
      | 'limite_debit_donnees',
    /** Limite de débit seulement : délai avant de pouvoir réessayer. */
    public readonly reessayerDansMs?: number
  ) {
    super(message)
    this.name = 'ErreurDonnees'
  }
}
