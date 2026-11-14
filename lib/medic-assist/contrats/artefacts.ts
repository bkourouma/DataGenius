/**
 * Spécifications d'artefacts (§4) : tableau, graphique, indicateurs, document.
 *
 * Un artefact est DÉCLARATIF : il ne porte ni HTML, ni JS, ni URL externe (textes
 * validés par les schémas « sûrs » de communs.ts), et jamais de chiffre recopié par
 * le modèle : tableau, graphique et cartes d'indicateurs référencent un jeu de
 * données par `jeuDeDonneesId`, le rendu lit les valeurs dans ce jeu.
 *
 * Un document imbrique des tableaux et des graphiques sous la forme de « contenus »
 * (la spécification sans le champ `type`) : pas de récursion, un document ne
 * contient jamais de document ni d'indicateurs en ligne (il peut en revanche citer
 * un artefact existant par son id). Pour rendre un bloc, le lot 4 reconstitue
 * l'artefact `{ type: bloc.type, ...bloc.spec }`.
 */

import { z } from 'zod'

import {
  CleColonneSchema,
  IdentifiantSchema,
  ScalaireSchema,
  markdownSurSchema,
  texteSurSchema,
} from '@/lib/medic-assist/contrats/communs'
import { LIMITES } from '@/lib/medic-assist/contrats/constantes'
import { FormatColonneSchema, TriSchema } from '@/lib/medic-assist/contrats/donnees'

const titreSchema = () =>
  texteSurSchema(
    LIMITES.longueurMaxTitre,
    'Titre court et explicite, dans la langue de l’utilisateur (ex. « CA par pays, janvier → juin 2026 »).'
  )

const sousTitreSchema = () =>
  texteSurSchema(
    LIMITES.longueurMaxSousTitre,
    'Sous-titre facultatif : périmètre, période ou précision de lecture.'
  ).optional()

const jeuDeDonneesIdSchema = () =>
  IdentifiantSchema.describe(
    'jeuDeDonneesId renvoyé par interroger_donnees, requete_sql ou lire_piece_jointe dans CETTE conversation. Les chiffres affichés viennent de ce jeu : ne jamais les recopier.'
  )

const libelleSchema = (description: string) =>
  texteSurSchema(LIMITES.longueurMaxLibelle, description).optional()

// ---------------------------------------------------------------------------
// Tableau
// ---------------------------------------------------------------------------

export const ColonneTableauSchema = z.strictObject({
  cle: CleColonneSchema,
  libelle: libelleSchema('En-tête affiché ; absent : le libellé de la colonne du jeu.'),
  format: FormatColonneSchema.optional(),
  visible: z
    .boolean()
    .optional()
    .describe('false pour masquer la colonne (elle reste dans les exports). Absent : visible.'),
})
export type ColonneTableau = z.infer<typeof ColonneTableauSchema>

export const OPERATEURS_FILTRE = [
  'egal',
  'different',
  'contient',
  'superieur',
  'superieur_ou_egal',
  'inferieur',
  'inferieur_ou_egal',
  'parmi',
  'entre',
] as const
export type OperateurFiltre = (typeof OPERATEURS_FILTRE)[number]

export const FiltreArtefactSchema = z.strictObject({
  cle: CleColonneSchema,
  operateur: z
    .enum(OPERATEURS_FILTRE)
    .describe(
      'egal, different, contient (texte), superieur, superieur_ou_egal, inferieur, inferieur_ou_egal, parmi (valeur = liste), entre (valeur = [min, max]).'
    ),
  valeur: z
    .union([ScalaireSchema, z.array(ScalaireSchema).min(1).max(100)])
    .describe('Valeur comparée ; une liste pour parmi, deux valeurs [min, max] pour entre.'),
})
export type FiltreArtefact = z.infer<typeof FiltreArtefactSchema>

export const AGREGATS = ['somme', 'moyenne', 'min', 'max', 'nombre'] as const
export type Agregat = (typeof AGREGATS)[number]

export const PivotSchema = z
  .strictObject({
    lignes: z
      .array(CleColonneSchema)
      .min(1)
      .max(3)
      .describe('Dimensions en lignes du tableau croisé (ex. ["pays"]).'),
    colonnes: z
      .array(CleColonneSchema)
      .max(2)
      .describe('Dimensions en colonnes (ex. ["periode"]) ; [] pour aucune.'),
    valeurs: z
      .array(
        z.strictObject({
          cle: CleColonneSchema,
          agregat: z
            .enum(AGREGATS)
            .describe(
              'somme, moyenne, min, max ou nombre. Un taux (pourcentage) ne se somme pas : préférer un jeu qui le calcule.'
            ),
        })
      )
      .min(1)
      .max(6)
      .describe('Mesures croisées et leur agrégat.'),
  })
  .describe('Tableau croisé facultatif, calculé par l’interface à partir du jeu.')
export type Pivot = z.infer<typeof PivotSchema>

const champsTableau = {
  titre: titreSchema(),
  sousTitre: sousTitreSchema(),
  jeuDeDonneesId: jeuDeDonneesIdSchema(),
  colonnes: z
    .array(ColonneTableauSchema)
    .min(1)
    .max(LIMITES.colonnesMaxTableau)
    .optional()
    .describe('Colonnes affichées, dans l’ordre. Absentes : toutes les colonnes du jeu.'),
  tri: z.array(TriSchema).max(5).optional().describe('Tri initial des lignes.'),
  filtres: z
    .array(FiltreArtefactSchema)
    .max(10)
    .optional()
    .describe('Filtres d’affichage appliqués aux lignes du jeu.'),
  pivot: PivotSchema.optional(),
  totaux: z
    .boolean()
    .optional()
    .describe('true pour afficher une ligne de totaux (colonnes additives seulement).'),
}

/** Tableau sans le discriminant : forme imbriquée dans un document. */
export const ContenuTableauSchema = z
  .strictObject(champsTableau)
  .describe('Tableau de données lié à un jeu de données.')
export type ContenuTableau = z.infer<typeof ContenuTableauSchema>

export const ArtefactTableauSchema = z.strictObject({
  type: z.literal('tableau').describe('Artefact tableau de données.'),
  ...champsTableau,
})
export type ArtefactTableau = z.infer<typeof ArtefactTableauSchema>

// ---------------------------------------------------------------------------
// Graphique
// ---------------------------------------------------------------------------

export const FORMES_GRAPHIQUE = [
  'barres',
  'barres_empilees',
  'barres_horizontales',
  'lignes',
  'aires',
  'secteurs',
  'anneau',
  'nuage',
  'combine',
  'carte_chaleur',
  'treemap',
  'entonnoir',
  'jauge',
] as const
export type FormeGraphique = (typeof FORMES_GRAPHIQUE)[number]

/** Formes qui ne représentent qu'une seule mesure. */
export const FORMES_UNE_MESURE: readonly FormeGraphique[] = [
  'secteurs',
  'anneau',
  'treemap',
  'entonnoir',
  'jauge',
  'carte_chaleur',
]

export const SerieGraphiqueSchema = z.strictObject({
  cle: CleColonneSchema.describe('Clé de la mesure (colonne numérique du jeu).'),
  libelle: libelleSchema('Nom de la série en légende ; absent : le libellé de la colonne.'),
  forme: z
    .enum(['barres', 'lignes'])
    .optional()
    .describe('Pour la forme combine seulement : barres ou lignes pour cette série.'),
  axe: z
    .enum(['gauche', 'droite'])
    .optional()
    .describe('Axe des ordonnées ; droite pour une mesure d’une autre échelle (ex. taux en %).'),
})
export type SerieGraphique = z.infer<typeof SerieGraphiqueSchema>

export const GraphiqueSpecSchema = z
  .strictObject({
    forme: z
      .enum(FORMES_GRAPHIQUE)
      .describe(
        'barres (comparer des catégories), barres_empilees, barres_horizontales (libellés longs, classements), lignes (évolution dans le temps), aires, secteurs / anneau (parts d’un tout, 7 parts au plus), nuage (corrélation de deux mesures), combine (barres + lignes, ex. CA et taux), carte_chaleur (deux dimensions croisées), treemap (hiérarchie de parts), entonnoir (étapes), jauge (une valeur face à un objectif).'
      ),
    x: CleColonneSchema.describe(
      'Clé de la dimension en abscisse ou des catégories (ex. periode, pays). Pour nuage : la mesure en abscisse.'
    ),
    y: z
      .array(SerieGraphiqueSchema)
      .min(1)
      .max(LIMITES.seriesMaxGraphique)
      .describe(
        'Mesures en ordonnée. Une seule pour secteurs, anneau, treemap, entonnoir, jauge, carte_chaleur ; deux au moins pour combine.'
      ),
    serie: CleColonneSchema.optional().describe(
      'Dimension qui éclate la mesure en plusieurs séries (ex. produit) ; obligatoire pour carte_chaleur (seconde dimension).'
    ),
    empile: z.boolean().optional().describe('true pour empiler les séries (barres ou aires).'),
    limite: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe(
        'Nombre de catégories affichées au plus (les suivantes sont regroupées ou omises).'
      ),
    trierPar: CleColonneSchema.optional().describe(
      'Clé de tri des catégories (une mesure pour un classement, la dimension pour l’ordre chronologique).'
    ),
    sens: z.enum(['asc', 'desc']).optional().describe('Sens du tri de trierPar ; absent : desc.'),
    format: FormatColonneSchema.optional(),
  })
  .superRefine((g, ctx) => {
    if (FORMES_UNE_MESURE.includes(g.forme) && g.y.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['y'],
        message: `La forme ${g.forme} représente une seule mesure : y doit contenir exactement une série.`,
      })
    }
    if (g.forme === 'combine' && g.y.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['y'],
        message:
          'La forme combine demande au moins deux séries (ex. une en barres, une en lignes).',
      })
    }
    if (g.forme === 'carte_chaleur' && !g.serie) {
      ctx.addIssue({
        code: 'custom',
        path: ['serie'],
        message: 'La forme carte_chaleur demande une seconde dimension dans serie.',
      })
    }
  })
  .describe('Forme et axes du graphique (rendu ECharts).')
export type GraphiqueSpec = z.infer<typeof GraphiqueSpecSchema>

const champsGraphique = {
  titre: titreSchema(),
  sousTitre: sousTitreSchema(),
  jeuDeDonneesId: jeuDeDonneesIdSchema(),
  graphique: GraphiqueSpecSchema,
}

/** Graphique sans le discriminant : forme imbriquée dans un document. */
export const ContenuGraphiqueSchema = z
  .strictObject(champsGraphique)
  .describe('Graphique lié à un jeu de données.')
export type ContenuGraphique = z.infer<typeof ContenuGraphiqueSchema>

export const ArtefactGraphiqueSchema = z.strictObject({
  type: z.literal('graphique').describe('Artefact graphique.'),
  ...champsGraphique,
})
export type ArtefactGraphique = z.infer<typeof ArtefactGraphiqueSchema>

// ---------------------------------------------------------------------------
// Indicateurs (cartes KPI)
// ---------------------------------------------------------------------------

export const SourceValeurSchema = z
  .strictObject({
    jeuDeDonneesId: jeuDeDonneesIdSchema(),
    colonne: CleColonneSchema.describe('Colonne qui porte la valeur.'),
    ligne: z
      .union([
        z
          .number()
          .int()
          .min(0)
          .max(LIMITES.lignesMaxStockees - 1),
        z.strictObject({
          cle: CleColonneSchema.describe('Colonne qui identifie la ligne (ex. pays).'),
          valeur: ScalaireSchema.describe('Valeur de cette colonne sur la ligne voulue.'),
        }),
      ])
      .optional()
      .describe(
        'Ligne lue : un rang (0 = première ligne) ou {cle, valeur}. Absente : le total de la colonne ; à défaut, l\'unique ligne d\'un jeu d\'une seule ligne ; sinon aucune valeur.'
      ),
  })
  .describe('Emplacement d’une valeur dans un jeu de données (jamais la valeur elle-même).')
export type SourceValeur = z.infer<typeof SourceValeurSchema>

export const CarteIndicateurSchema = z.strictObject({
  libelle: texteSurSchema(LIMITES.longueurMaxLibelle, 'Libellé de la carte (ex. « CA du mois »).'),
  source: SourceValeurSchema,
  format: FormatColonneSchema.optional(),
  comparaison: z
    .strictObject({
      source: SourceValeurSchema,
      libelle: texteSurSchema(
        LIMITES.longueurMaxLibelle,
        'Libellé de la référence (ex. « N-1 », « mois précédent »).'
      ),
    })
    .optional()
    .describe('Valeur de référence affichée en variation.'),
  objectif: z
    .strictObject({
      source: SourceValeurSchema,
      libelle: libelleSchema('Libellé de l’objectif ; absent : « Objectif ».'),
    })
    .optional()
    .describe('Objectif (ex. budget) : la carte affiche le taux et le badge Atteint / En cours.'),
})
export type CarteIndicateur = z.infer<typeof CarteIndicateurSchema>

export const ArtefactIndicateursSchema = z.strictObject({
  type: z.literal('indicateurs').describe('Artefact de cartes d’indicateurs clés (KPI).'),
  titre: titreSchema(),
  sousTitre: sousTitreSchema(),
  cartes: z
    .array(CarteIndicateurSchema)
    .min(1)
    .max(LIMITES.cartesMaxIndicateurs)
    .describe('Cartes d’indicateurs clés, dans l’ordre d’affichage.'),
})
export type ArtefactIndicateurs = z.infer<typeof ArtefactIndicateursSchema>

// ---------------------------------------------------------------------------
// Document (analyse approfondie)
// ---------------------------------------------------------------------------

export const BlocTexteSchema = z.strictObject({
  type: z.literal('texte').describe('Bloc de texte markdown.'),
  markdown: markdownSurSchema(
    LIMITES.longueurMaxMarkdown,
    'Texte du bloc : constats, causes, recommandations.'
  ),
})

export const BlocArtefactSchema = z.strictObject({
  type: z.literal('artefact').describe('Bloc qui insère un artefact existant.'),
  artefactId: IdentifiantSchema.describe(
    'Id d’un artefact déjà créé dans cette conversation (renvoyé par creer_artefact), inséré tel quel.'
  ),
})

export const BlocGraphiqueSchema = z.strictObject({
  type: z.literal('graphique').describe('Bloc graphique en ligne.'),
  spec: ContenuGraphiqueSchema,
})

export const BlocTableauSchema = z.strictObject({
  type: z.literal('tableau').describe('Bloc tableau en ligne.'),
  spec: ContenuTableauSchema,
})

export const BlocDocumentSchema = z.discriminatedUnion('type', [
  BlocTexteSchema,
  BlocArtefactSchema,
  BlocGraphiqueSchema,
  BlocTableauSchema,
])
export type BlocDocument = z.infer<typeof BlocDocumentSchema>

export const ArtefactDocumentSchema = z.strictObject({
  type: z.literal('document').describe('Artefact document : rapport d’analyse structuré en blocs.'),
  titre: titreSchema(),
  sousTitre: sousTitreSchema(),
  blocs: z
    .array(BlocDocumentSchema)
    .min(1)
    .max(LIMITES.blocsMaxDocument)
    .describe(
      'Blocs dans l’ordre de lecture : texte (markdown), artefact (id existant), graphique ou tableau (spécification sans champ type).'
    ),
})
export type ArtefactDocument = z.infer<typeof ArtefactDocumentSchema>

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export const ArtefactSpecSchema = z
  .discriminatedUnion('type', [
    ArtefactTableauSchema,
    ArtefactGraphiqueSchema,
    ArtefactIndicateursSchema,
    ArtefactDocumentSchema,
  ])
  .describe(
    'Spécification d’artefact, discriminée par type : tableau, graphique, indicateurs (cartes KPI) ou document (rapport d’analyse approfondie). Créer un artefact dès qu’un tableau dépasse 5 lignes ou qu’un graphique aide à lire.'
  )
export type ArtefactSpec = z.infer<typeof ArtefactSpecSchema>

/**
 * Ids des jeux de données qu'une spécification référence (blocs imbriqués compris),
 * sans doublon, dans l'ordre d'apparition. Les blocs `artefact` ne sont pas suivis :
 * leurs jeux appartiennent à l'artefact cité.
 */
export function jeuxReferences(spec: ArtefactSpec): string[] {
  const ids: string[] = []
  const ajouter = (id: string) => {
    if (!ids.includes(id)) ids.push(id)
  }
  switch (spec.type) {
    case 'tableau':
    case 'graphique':
      ajouter(spec.jeuDeDonneesId)
      break
    case 'indicateurs':
      for (const carte of spec.cartes) {
        ajouter(carte.source.jeuDeDonneesId)
        if (carte.comparaison) ajouter(carte.comparaison.source.jeuDeDonneesId)
        if (carte.objectif) ajouter(carte.objectif.source.jeuDeDonneesId)
      }
      break
    case 'document':
      for (const bloc of spec.blocs) {
        if (bloc.type === 'graphique' || bloc.type === 'tableau') ajouter(bloc.spec.jeuDeDonneesId)
      }
      break
  }
  return ids
}

/** Ids des artefacts qu'un document insère (blocs `artefact`). */
export function artefactsReferences(spec: ArtefactSpec): string[] {
  if (spec.type !== 'document') return []
  const ids: string[] = []
  for (const bloc of spec.blocs) {
    if (bloc.type === 'artefact' && !ids.includes(bloc.artefactId)) ids.push(bloc.artefactId)
  }
  return ids
}
