/**
 * Types partagés entre les modules purs, les composants et les exports du lot 4.
 *
 * Ce fichier ne contient que des types : il est importable côté client et côté serveur.
 * Les formes sont figées par le chef de lot ; une évolution se signale dans le rapport.
 */

import type { NombreAnalytique } from '@/lib/medic-assist/contrats/numerique'
import type {
  ArtefactSpec,
  ColonneJeu,
  FormatColonne,
  FormeGraphique,
  Provenance,
  TypeArtefact,
} from '@/lib/medic-assist/contrats'

// ---------------------------------------------------------------------------
// Données transmises au client
// ---------------------------------------------------------------------------

/** Un jeu de données tel que le rend GET /api/medic-assist/artefacts/[id] (recalculé pour le lecteur). */
export interface JeuClient {
  jeuDeDonneesId: string
  colonnes: ColonneJeu[]
  /** Au plus 10 000 lignes stockées ; la clé de chaque ligne est `ColonneJeu.cle`. */
  lignes: Record<string, unknown>[]
  nbLignes: number
  tronque: boolean
  totaux?: Record<string, NombreAnalytique>
  provenance: Provenance
  /** Lignes non chargées : limite de rejeux atteinte, à réessayer dans ce délai. */
  limiteDebit?: { reessayerDansSecondes: number }
}

export interface VersionArtefact {
  version: number
  /** ISO 8601. */
  creeLe: string
}

/** Artefact prêt à rendre : spécification + jeux de données référencés. */
export interface ArtefactClient {
  id: string
  /** Id de la première version : toutes les versions d'un artefact partagent la même racine. */
  racineId: string
  version: number
  versions: VersionArtefact[]
  type: TypeArtefact
  titre: string
  sousTitre?: string
  spec: ArtefactSpec
  /** Par `jeuDeDonneesId`. */
  jeux: Record<string, JeuClient>
  /** Artefacts cités par les blocs `artefact` d'un document, par id (un seul niveau). */
  artefactsLies?: Record<string, ArtefactClient>
  conversationId: string | null
  /** ISO 8601. */
  creeLe: string
  /** Vrai si le lecteur est le propriétaire : lui seul édite (PATCH) ; les autres lisent. */
  modifiable: boolean
}

// ---------------------------------------------------------------------------
// Tableau (tri, filtre, colonnes, pivot, totaux)
// ---------------------------------------------------------------------------

export interface ColonneModele {
  /** Clé de la ligne (`ModeleTableau.lignes[i][id]`). */
  id: string
  libelle: string
  /** Pivot : niveaux d'en-tête de colonne, du plus général au plus fin (ex. ['2026-04', 'CA']). */
  entete?: string[]
  format: FormatColonne
  type: 'dimension' | 'valeur' | 'total'
  alignement: 'start' | 'end'
  /** Unité de la colonne du jeu, le cas échéant. */
  unite?: string
}

/** Tableau prêt à afficher ou à exporter : ce que voit l'utilisateur, valeurs BRUTES (non formatées). */
export interface ModeleTableau {
  colonnes: ColonneModele[]
  lignes: Record<string, unknown>[]
  /** Ligne de totaux (colonnes additives seulement), `null` si non demandée. L'appelant écrit le libellé « Total ». */
  totaux: Record<string, unknown> | null
  estPivot: boolean
  /** Lignes du jeu avant filtre. */
  nbLignesSource: number
  /** Lignes après filtre (avant pivot). */
  nbLignesFiltrees: number
}

// ---------------------------------------------------------------------------
// Graphique
// ---------------------------------------------------------------------------

/** Option ECharts consommée dans le même processus (jamais sérialisée) : les fonctions de formatage y sont permises. */
export type OptionGraphique = Record<string, unknown>

/** Traducteur injecté (client : next-intl ; serveur : createTranslator). Clés relatives au namespace medicAssistArtefacts. */
export type Traducteur = (cle: string, valeurs?: Record<string, string | number>) => string

export interface ContexteGraphique {
  locale: string
  theme: 'clair' | 'sombre'
  /** Arabe : axes, légende et infobulles inversés. */
  rtl: boolean
  traduire: Traducteur
  /** Petit conteneur (carte, diapositive) : légende en bas, pas de zoom, polices réduites. */
  compact?: boolean
  /** Export statique (PDF, PNG, PPTX) : pas d'animation, pas d'infobulle, pas de toolbox. */
  statique?: boolean
}

export type CodeAvertissementGraphique =
  | 'forme_changee' // la forme demandée est inadaptée, une autre a été utilisée
  | 'limite_appliquee' // top N + « Autres »
  | 'donnees_vides'
  | 'serie_ignoree'

export interface AvertissementGraphique {
  code: CodeAvertissementGraphique
  valeurs?: Record<string, string | number>
}

export interface ResultatOptionGraphique {
  option: OptionGraphique
  formeEffective: FormeGraphique
  avertissements: AvertissementGraphique[]
  /** Aucun point à tracer : afficher l'état vide plutôt qu'un cadre blanc. */
  vide: boolean
}

// ---------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------

export type StatutObjectif = 'atteint' | 'en_cours' | 'a_risque'

export interface IndicateurResolu {
  libelle: string
  /** `null` si la source est introuvable (jeu, colonne ou ligne absents). */
  valeur: NombreAnalytique | null
  format: FormatColonne
  valeurFormatee: string
  comparaison?: {
    libelle: string
    valeur: NombreAnalytique | null
    valeurFormatee: string
    /** Variation relative en points de pourcentage ; null si la référence est nulle ou absente. */
    variationPct: number | null
    sens: 'hausse' | 'baisse' | 'stable' | null
  }
  objectif?: {
    libelle?: string
    valeur: NombreAnalytique | null
    valeurFormatee: string
    /** Taux de réalisation en points (valeur / objectif × 100) ; null si objectif nul ou absent. */
    taux: number | null
    statut: StatutObjectif | null
  }
}
