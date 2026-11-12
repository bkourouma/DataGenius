/**
 * Types et constantes du stockage des jeux de données (lot 2).
 */

import type { NombreAnalytique } from '@/lib/medic-assist/contrats/numerique'
import { z } from 'zod'

import type { ColonneJeu, LigneJeu, Provenance, SourceJeu } from '@/lib/medic-assist/contrats'

/** Message UNIQUE d'un jeu absent ou inaccessible : l'appelant ne doit pas pouvoir les distinguer. */
export const MESSAGE_JEU_INTROUVABLE = 'Jeu de données introuvable.'

/**
 * Lecture au nom d'un artefact dont l'accès a DÉJÀ été vérifié par le lot 4 (et dont on a
 * vérifié que le jeu y est référencé). Jamais alimentée par un client ni par le modèle : aucune
 * route ne la lit. Le jeu est chargé par { id, userId: proprietaireId } dans le même where.
 */
export interface OptionsViaArtefact {
  viaArtefact?: { proprietaireId: string }
}

/** Options de lecture paginée d'un jeu de données. */
export interface OptionsLireJeu extends OptionsViaArtefact {
  /** Rejoue la spécification avec le périmètre du lecteur au lieu du cache. */
  recalculer?: boolean
  /** Page à partir de 1. */
  page?: number
  /** Lignes par page (LIMITES.taillePageJeuDefaut par défaut, taillePageJeuMax au plus). */
  taille?: number
}

/** Contenu complet d'un jeu, recalculé pour un export (jusqu'à LIMITES.lignesMaxExport). */
export interface JeuCompletPourExport {
  colonnes: ColonneJeu[]
  lignes: LigneJeu[]
  /** Totaux exacts du jeu rejoué (mêmes que ceux de `lireJeu`), absents si le jeu n'en porte pas. */
  totaux?: Record<string, NombreAnalytique>
  /** Provenance dans le périmètre du lecteur (le SQL n'y figure que pour un admin). */
  provenance: Provenance
}

/** Spécification d'un jeu `piece_jointe` (jamais rejouée : sert à citer la source). */
export const RequetePieceJointeSchema = z.object({
  pieceJointeId: z.string().min(1).max(128),
  feuille: z.string().min(1).max(200),
  plage: z.string().min(1).max(100).optional(),
})
export type RequetePieceJointe = z.infer<typeof RequetePieceJointeSchema>

/** Données brutes à ranger dans un jeu de données (outil lire_piece_jointe, lot 6). */
export interface DonneesJeuAEnregistrer {
  source: SourceJeu
  /**
   * Spécification rejouable : `RequeteSemantique` (source `semantique`), SQL et objectif
   * (source `sql`) ou référence de la pièce jointe (source `piece_jointe`).
   */
  requete: unknown
  colonnes: ColonneJeu[]
  lignes: Record<string, unknown>[]
  provenance: Provenance
}
