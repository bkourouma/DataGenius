/** Types communs des pieces jointes (extraction, resume, lecture). */

import type { ColonneJeu, LigneJeu } from './imports-lot0'

/** Plafonds d'extraction. */
export const PLAFONDS = {
  feuillesMax: 20,
  lignesDonneesMax: 5_000,
  lignesRechercheEntete: 20,
  colonnesMax: 200,
  pagesPdfMax: 50,
  caracteresTexteMax: 200_000,
  caracteresCelluleMax: 2_000,
  caracteresRenduMax: 30_000,
  colonnesResume: 20,
} as const

export interface FeuilleExtraite {
  nom: string
  colonnes: ColonneJeu[]
  lignes: LigneJeu[]
  /** Numero (1 = premiere) de la ligne d'en-tete dans la feuille. */
  ligneEntete: number
  /** Lignes de donnees vues dans la feuille, au-dela du plafond comprises. */
  nbLignesVues: number
  tronque: boolean
  /** Numero de colonne de la feuille (1 = A) pour chaque colonne de `colonnes`. */
  indexColonnes: number[]
  /** Numero de ligne de la feuille pour chaque ligne de `lignes`. */
  numerosLignes: number[]
}

export interface ContenuTableau {
  type: 'tableau'
  feuilles: FeuilleExtraite[]
  /** Nombre de feuilles du classeur (peut depasser feuilles.length). */
  nbFeuilles: number
}

export interface ContenuTexte {
  type: 'texte'
  /** 'pdf' : la plage designe des pages ; 'texte' : des lignes. */
  format: 'pdf' | 'texte'
  pages: { numero: number; texte: string }[]
  nbPages: number
  tronque: boolean
}

export type ContenuExtrait = ContenuTableau | ContenuTexte

/** Ce qui est garde en base : jamais le contenu complet. */
export type ResumePieceJointe = {
  type: 'tableau' | 'texte'
  feuilles?: {
    nom: string
    nbLignes: number
    nbColonnes: number
    colonnes: string[]
    tronque: boolean
  }[]
  nbFeuilles?: number
  nbPages?: number
  tronque?: boolean
}

export type ExtracteurPdf = (octets: Uint8Array) => Promise<ContenuTexte>

export interface DependancesExtraction {
  extrairePdf?: ExtracteurPdf
}
