/**
 * Contrats de la couche de données (§4, §5) : requête sémantique, colonnes,
 * provenance et résultat d'un jeu de données, description d'un jeu du catalogue.
 *
 * Conventions de valeur communes à tous les lots :
 * - montant : euros (EUR), nombre décimal non arrondi ;
 * - pourcentage : points de pourcentage (85 = 85 %), comme `tauxDeRealisation` ;
 * - periode : chaîne `YYYY-MM` ; date : chaîne `YYYY-MM-DD` ;
 * - les libellés (noms de produits, pays...) sont dans les colonnes texte, jamais
 *   les identifiants seuls (CONSTITUTION, règle 4).
 */

import { z } from 'zod'

import {
  CelluleSchema,
  CleColonneSchema,
  HorodatageSchema,
  IdentifiantSchema,
  LienInterneSchema,
  PeriodeMoisSchema,
  ScalaireSchema,
} from '@/lib/medic-assist/contrats/communs'
import { LIMITES } from '@/lib/medic-assist/contrats/constantes'

// ---------------------------------------------------------------------------
// Jeux, colonnes, formats
// ---------------------------------------------------------------------------

export const CleJeuSchema = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/).describe('Clé du jeu dans le catalogue de la source.')

/** Type d'une colonne de jeu de données (§4). */
export const TYPES_COLONNE = [
  'texte',
  'entier',
  'decimal',
  'montant',
  'pourcentage',
  'date',
  'periode',
] as const
export type TypeColonne = (typeof TYPES_COLONNE)[number]
export const TypeColonneSchema = z.enum(TYPES_COLONNE)

/**
 * Format d'affichage d'une valeur. Reprend les types de colonne, plus
 * `montant_compact` (k€, M€) pour les cartes et les axes de graphique.
 */
export const FORMATS_COLONNE = [...TYPES_COLONNE, 'montant_compact'] as const
export type FormatColonne = (typeof FORMATS_COLONNE)[number]
export const FormatColonneSchema = z
  .enum(FORMATS_COLONNE)
  .describe(
    'Format d’affichage : texte, entier, decimal, montant (euros), montant_compact (k€, M€), pourcentage (la valeur est en points : 85 = 85 %), date, periode (AAAA-MM). Absent : le format de la colonne du jeu.'
  )

export const ColonneJeuSchema = z.object({
  cle: CleColonneSchema,
  libelle: z.string().min(1).max(LIMITES.longueurMaxLibelle),
  type: TypeColonneSchema,
  /** Unité affichée en complément (ex. « EUR », « unités », « mois »). */
  unite: z.string().max(20).optional(),
})
export type ColonneJeu = z.infer<typeof ColonneJeuSchema>

// ---------------------------------------------------------------------------
// Provenance (« Comment j'ai calculé »)
// ---------------------------------------------------------------------------

export const SOURCES_JEU = ['semantique', 'sql', 'piece_jointe'] as const
export type SourceJeu = (typeof SOURCES_JEU)[number]

export const ProvenanceSchema = z.object({
  source: z.enum(SOURCES_JEU),
  /** Jeu du catalogue interrogé (source semantique). */
  jeu: z.string().max(64).optional(),
  /** Libellé lisible de la source, ex. « Ventes (sorties locales) ». */
  libelleSource: z.string().min(1).max(200),
  periode: z
    .object({
      debut: PeriodeMoisSchema,
      fin: PeriodeMoisSchema,
      /** Ex. « avril → septembre 2026 », « exercice 2026-2027 ». */
      libelle: z.string().max(120),
    })
    .optional(),
  /**
   * Périmètre réellement appliqué (celui du lecteur, jamais choisi par l'IA) :
   * `pays` = 'tous' ou les ids des pays retenus (empreinte du périmètre) ;
   * `libelle` = leurs noms, pour l'affichage.
   */
  perimetre: z.object({
    pays: z.union([z.literal('tous'), z.array(z.string())]),
    libelle: z.string().max(300),
  }),
  /** Filtres appliqués, en libellés (pas d'identifiants). */
  filtres: z.array(z.object({ libelle: z.string().max(120), valeur: z.string().max(500) })),
  /** Règles métier appliquées, ex. « CA = quantité × PGHT de la ligne », « inactifs exclus ». */
  regles: z.array(z.string().max(300)),
  /**
   * Ordre effectif des lignes du jeu quand il est un classement par valeur (Top N : tri explicite
   * ou limite, première clé = une mesure). Absent sinon (jeux anciens, SQL) : l'affichage suit alors
   * le tri par libellé. Les lignes sont stockées dans cet ordre ; il sert à le conserver à l'écran
   * et dans les exports.
   */
  ordre: z
    .array(z.object({ cle: CleColonneSchema, sens: z.enum(['asc', 'desc']) }))
    .max(10)
    .optional(),
  /** Requête SQL exécutée : affichée aux administrateurs seulement. */
  sql: z.string().optional(),
  /** Écran équivalent de MedicPro, avec les paramètres d'URL qu'il lit vraiment. */
  lienEcran: LienInterneSchema.optional(),
  calculeA: HorodatageSchema,
})
export type Provenance = z.infer<typeof ProvenanceSchema>

// ---------------------------------------------------------------------------
// Résultat d'un jeu de données
// ---------------------------------------------------------------------------

export const ResultatJeuSchema = z.object({
  jeuDeDonneesId: IdentifiantSchema,
  colonnes: z.array(ColonneJeuSchema).min(1),
  /** Premières lignes seulement (au plus LIMITES.lignesApercu). */
  apercu: z.array(z.record(z.string(), CelluleSchema)).max(LIMITES.lignesApercu),
  /** Nombre total de lignes du jeu (après plafond de stockage). */
  nbLignes: z.number().int().min(0),
  /** Vrai si le jeu a été coupé à LIMITES.lignesMaxStockees. */
  tronque: z.boolean(),
  /** Totaux des colonnes additives, calculés par le serveur sur tout le jeu. */
  totaux: z.record(z.string(), z.number()).optional(),
  provenance: ProvenanceSchema,
})
/**
 * Ce que renvoient interroger_donnees, requete_sql et (le cas échéant)
 * lire_piece_jointe. Le modèle cite `jeuDeDonneesId` dans ses artefacts au lieu de
 * recopier les chiffres.
 */
export type ResultatJeu = z.infer<typeof ResultatJeuSchema>

// ---------------------------------------------------------------------------
// Requête sémantique
// ---------------------------------------------------------------------------

export const PeriodePlageSchema = z
  .strictObject({
    debut: PeriodeMoisSchema.describe('Premier mois inclus, AAAA-MM.'),
    fin: PeriodeMoisSchema.describe('Dernier mois inclus, AAAA-MM (égal ou postérieur à debut).'),
  })
  .refine(p => p.debut <= p.fin, { error: 'La période doit aller de debut à fin (debut ≤ fin).' })

export const PeriodeExerciceSchema = z.strictObject({
  exercice: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .describe(
      'Exercice ILAPHARM désigné par son année de début : l’exercice 2026 va d’avril 2026 à mars 2027.'
    ),
})

export const PeriodeDernierMoisClosSchema = z.strictObject({
  dernierMoisClos: z
    .literal(true)
    .describe(
      'Le dernier mois clos (jour limite de saisie passé) : la période par défaut de tous les rapports.'
    ),
})

export const PeriodeRequeteSchema = z
  .union([PeriodePlageSchema, PeriodeExerciceSchema, PeriodeDernierMoisClosSchema])
  .describe(
    'Période : soit {debut, fin} en AAAA-MM, soit {exercice: année de début} (avril → mars), soit {dernierMoisClos: true}. Absente : le serveur applique la période par défaut du jeu (dernier mois clos pour les ventes). Les mois non clos sont incomplets : le dire à l’utilisateur.'
  )
export type PeriodeRequete = z.infer<typeof PeriodeRequeteSchema>

/** Clé d'un filtre supplémentaire déclaré par le catalogue. */
const CleFiltreSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/)

export const FiltresRequeteSchema = z
  .strictObject({
    autres: z
      .record(
        CleFiltreSchema,
        z.union([ScalaireSchema, z.array(ScalaireSchema).min(1).max(LIMITES.idsMaxParFiltre)])
      )
      .optional()
      .describe(
        'Autres filtres, UNIQUEMENT ceux que catalogue_donnees déclare pour ce jeu (clé du filtre → valeur ou liste de valeurs). Un filtre non déclaré est refusé par le serveur.'
      ),
  })
  .describe(
    'Filtres de la requête. Le périmètre de l’utilisateur est toujours appliqué en plus par le serveur.'
  )
export type FiltresRequete = z.infer<typeof FiltresRequeteSchema>

export const TriSchema = z.strictObject({
  cle: CleColonneSchema.describe('Clé d’une mesure ou d’une dimension demandée.'),
  sens: z.enum(['asc', 'desc']).describe('asc : croissant ; desc : décroissant.'),
})
export type Tri = z.infer<typeof TriSchema>

export const GRANULARITES = ['mois', 'trimestre', 'exercice', 'annee'] as const
export type Granularite = (typeof GRANULARITES)[number]

export const RequeteSemantiqueSchema = z
  .strictObject({
    jeu: CleJeuSchema,
    mesures: z
      .array(CleColonneSchema)
      .max(20)
      .describe(
        'Clés des mesures définies dans le catalogue. Une liste vide permet de lister les dimensions.'
      ),
    dimensions: z
      .array(CleColonneSchema)
      .max(6)
      .optional()
      .describe(
        'Clés des dimensions de regroupement. Absentes : une seule ligne de totaux.'
      ),
    filtres: FiltresRequeteSchema.optional(),
    tri: z
      .array(TriSchema)
      .max(5)
      .optional()
      .describe('Ordre des lignes, par priorité décroissante.'),
    limite: z
      .number()
      .int()
      .min(1)
      .max(LIMITES.lignesMaxStockees)
      .optional()
      .describe(
        'Nombre de lignes au plus (après tri), ex. 10 pour un Top 10. Absent : toutes les lignes, dans la limite de 10 000.'
      ),
    granularite: z
      .enum(GRANULARITES)
      .optional()
      .describe(
        'Pas de temps uniquement lorsque le catalogue du jeu le déclare.'
      ),
  })
  .describe(
    'Requête sur un jeu publié. Les définitions et les unités proviennent du catalogue administrateur.'
  )
export type RequeteSemantique = z.infer<typeof RequeteSemantiqueSchema>

// ---------------------------------------------------------------------------
// Description d'un jeu du catalogue (sortie de catalogue_donnees)
// ---------------------------------------------------------------------------

export interface ChampCatalogue {
  cle: string
  libelle: string
  type: TypeColonne
  format?: FormatColonne
  unite?: string
  /** Définition métier (ex. « CA = quantité vendue × PGHT de la ligne »). */
  definition: string
}

export type TypeFiltreCatalogue = 'ids' | 'texte' | 'statuts' | 'booleen' | 'nombre' | 'periode'

export interface FiltreCatalogue {
  /** Clé du filtre : l'une des clés fixes de FiltresRequete, ou une clé de `autres`. */
  cle: string
  libelle: string
  type: TypeFiltreCatalogue
  /** Vrai pour un filtre à passer dans `filtres.autres`. */
  autre: boolean
  /** Valeurs permises (statuts, listes fermées). */
  valeurs?: Array<{ valeur: string; libelle: string }>
  description?: string
}

export interface DescriptionJeu {
  cle: string
  libelle: string
  description: string
  /** Ce que représente une ligne avant regroupement (ex. « une ligne de sortie locale »). */
  grain: string
  dimensions: ChampCatalogue[]
  mesures: ChampCatalogue[]
  filtres: FiltreCatalogue[]
  granularites: Granularite[]
  /** Période appliquée quand la requête n'en donne pas (libellé). */
  periodeParDefaut?: string
  /** Règles métier appliquées par le serveur. */
  regles: string[]
  /** Vue logique SQL correspondante (ex. mv_ventes), pour requete_sql. */
  vueSql?: string
}
