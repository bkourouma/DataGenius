/**
 * Forme HTTP de GET|PATCH /api/medic-assist/artefacts/[id] : l'`ArtefactDto` du contrat
 * (lot 0) plus les lignes des jeux de données, recalculées dans le périmètre du lecteur.
 * Le DTO du contrat ne porte que les métadonnées des jeux (`jeux: JeuLieDto[]`) ; le
 * rendu a besoin des lignes, qui viennent de `lireJeu` du lot 2.
 *
 * Fichier de types : importable côté client et côté serveur.
 */

import type { NombreAnalytique } from '@/lib/medic-assist/contrats/numerique'
import type { ArtefactDto, LigneJeu } from '@/lib/medic-assist/contrats'

export interface DonneesJeuReponse {
  /** Au plus LIMITES.lignesMaxStockees lignes. */
  lignes: LigneJeu[]
  totaux?: Record<string, NombreAnalytique>
}

/** Jeu non lu parce que le lecteur a dépassé la limite de rejeux : quand réessayer. */
export interface JeuLimiteReponse {
  reessayerDansSecondes: number
}

export interface ArtefactReponse extends ArtefactDto {
  /** Par `jeuDeDonneesId`. */
  donnees: Record<string, DonneesJeuReponse>
  /**
   * Jeux absents de `donnees` à cause de la limite de débit des rejeux (par `jeuDeDonneesId`).
   * Absent quand aucun jeu n'est limité ; les autres erreurs de lecture omettent le jeu sans trace ici.
   */
  jeuxLimites?: Record<string, JeuLimiteReponse>
  /** Artefacts cités par les blocs `artefact` d'un document, par id (un seul niveau). */
  artefactsLies?: Record<string, ArtefactReponse>
}

/** Élément de GET /api/medic-assist/artefacts?conversationId=… (onglets du panneau). */
export interface ArtefactResumeReponse {
  id: string
  racineId: string
  type: ArtefactDto['type']
  titre: string
  sousTitre?: string
  version: number
  /** ISO 8601 : date de la dernière version. */
  majA: string
}
