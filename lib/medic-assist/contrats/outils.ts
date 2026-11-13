/**
 * Les onze outils de l'agent (§4) : schéma zod d'entrée et type de sortie.
 *
 * Ces schémas zod sont la source de vérité de l'entrée de chaque outil. Ils ne s'emploient PLUS
 * tels quels avec le SDK : `schemaEntreeOutil(nom)` (lib/medic-assist/agent/schemas-modele.ts)
 * en dérive le JSON Schema COMPACT montré au modèle (annotations élaguées, descriptions
 * courtes) et valide l'entrée avec le schéma zod COMPLET d'ici, refine compris :
 *   tool({ description, inputSchema: schemaEntreeOutil('interroger_donnees'), execute })
 * Règles qui les gardent convertibles en JSON Schema (voir NOTES-SDK.md) :
 * - racine toujours objet (`z.strictObject`), exigé par les API Anthropic et OpenAI ;
 * - ni transform, ni preprocess, ni default, ni coerce ;
 * - les refine/superRefine (anti-URL/HTML, cohérences) ne passent pas dans le JSON
 *   Schema mais s'exécutent à la validation de l'entrée : la règle est dite en clair
 *   dans la description de l'outil (agent/outils.ts), une seule fois ;
 * - expressions régulières sans lookahead.
 *
 * Les implémentations (§6) : lot 2 pour les outils de données, lot 4 pour les
 * artefacts, lot 5 pour proposer_action, lot 1 pour proposer_relances. Une erreur
 * prévisible (SQL refusé, entité introuvable) se renvoie sous la forme ErreurOutil
 * plutôt que levée, pour que le modèle puisse corriger.
 */

import { z } from 'zod'

import {
  ParametresCreerTacheSchema,
  ParametresEnvoyerEmailSchema,
  ParametresNotifierSchema,
  ParametresProgrammerRapportSchema,
  SCHEMAS_PARAMETRES_ACTION,
  TypeActionSchema,
} from '@/lib/medic-assist/contrats/actions'
import { TYPES_REGLE } from '@/lib/notifications/types'
import { ArtefactSpecSchema } from '@/lib/medic-assist/contrats/artefacts'
import {
  IdentifiantSchema,
  PeriodeMoisSchema,
  texteSurSchema,
} from '@/lib/medic-assist/contrats/communs'
import {
  LIMITES,
  TYPES_ENTITES,
  type NomOutil,
  type StatutAction,
  type TypeAction,
  type TypeArtefact,
  type TypeEntite,
} from '@/lib/medic-assist/contrats/constantes'
import {
  CleJeuSchema,
  RequeteSemantiqueSchema,
  type DescriptionJeu,
  type Provenance,
  type ResultatJeu,
} from '@/lib/medic-assist/contrats/donnees'

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------

export const EntreeCatalogueDonneesSchema = z
  .strictObject({
    jeu: CleJeuSchema.describe(
      'Jeu métier dont on veut le détail : dimensions, mesures (avec leur définition métier), filtres permis, granularités et règles de calcul.'
    ),
  })
  .describe('Détail d’un jeu métier du catalogue, à lire avant une requête sur ce jeu.')

export const EntreeRechercherEntitesSchema = z
  .strictObject({
    texte: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'Nom, code ou fragment cherché (ex. « Côte d’Ivoire », « amoxi », « Awa »). Insensible à la casse et aux accents.'
      ),
    types: z
      .array(z.enum(TYPES_ENTITES))
      .min(1)
      .max(TYPES_ENTITES.length)
      .optional()
      .describe(
        'Types d’entités cherchés : produit, pays, grossiste, agence, molecule, laboratoire, classe_therapeutique, utilisateur. Absent : tous.'
      ),
    limite: z
      .number()
      .int()
      .min(1)
      .max(LIMITES.resultatsMaxRecherche)
      .optional()
      .describe('Nombre de résultats au plus ; absent : 10.'),
  })
  .describe(
    'Retrouve l’id d’une entité à partir de son nom, avant de filtrer une requête ou de désigner un destinataire. Seules les entités du périmètre de l’utilisateur sont renvoyées.'
  )

/** interroger_donnees prend directement une requête sémantique. */
export const EntreeInterrogerDonneesSchema = RequeteSemantiqueSchema

export const EntreeRequeteSqlSchema = z
  .strictObject({
    sql: z
      .string()
      .min(1)
      .max(LIMITES.longueurMaxSql)
      .describe(
        'UNE seule instruction SELECT PostgreSQL (CTE WITH permises), qui ne lit QUE les vues logiques mv_* fournies (mv_ventes, mv_budget, mv_stocks, mv_produits, mv_pays, mv_grossistes, mv_agences, mv_molecules, mv_prix, mv_procedures_amm, mv_visas, mv_mep, mv_info_pays...). Pas de schéma préfixé, pas de point-virgule, pas de fonction système. Les vues sont déjà filtrées par périmètre et sans inactifs ; ca_eur y est déjà calculé. Nommer les colonnes avec des alias lisibles en snake_case. Le serveur impose un LIMIT et un délai de 15 s.'
      ),
    objectif: texteSurSchema(
      500,
      'Ce que la requête calcule, en une phrase pour l’utilisateur (affiché dans « Comment j’ai calculé »).'
    ),
  })
  .describe(
    'Requête SQL en lecture seule, quand interroger_donnees ne suffit pas (croisement inhabituel, calcul de fenêtre...).'
  )

export const EntreeResumeMensuelSchema = z
  .strictObject({
    periode: PeriodeMoisSchema.optional().describe(
      'Mois complet à résumer, AAAA-MM ; absent : le dernier mois complet. Le mois en cours est refusé.'
    ),
    paysId: IdentifiantSchema.optional().describe(
      'Id d’un pays (rechercher_entites) pour résumer ce seul pays ; absent : tout le périmètre.'
    ),
  })
  .describe(
    'Synthèse de la revue du mois : réalisé, budget, cumul de l’exercice, prévision à fin d’exercice, alertes, écarts par pays, mouvements.'
  )

export const EntreeLirePieceJointeSchema = z
  .strictObject({
    pieceJointeId: IdentifiantSchema.describe(
      'Id d’une pièce jointe de la conversation (listée dans le message de l’utilisateur).'
    ),
    feuille: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Classeur Excel : nom de la feuille à lire ; absente : la première.'),
    plage: z
      .string()
      .regex(/^[A-Za-z]{1,3}[0-9]{1,7}(?::[A-Za-z]{1,3}[0-9]{1,7})?$/)
      .optional()
      .describe('Classeur Excel : plage à lire, ex. A1:H200 ; absente : la zone utilisée.'),
  })
  .describe(
    'Lit une pièce jointe (Excel, CSV, PDF, texte). Un contenu tabulaire devient un jeu de données (source piece_jointe) utilisable dans un artefact.'
  )

export const EntreeCreerArtefactSchema = z
  .strictObject({ spec: ArtefactSpecSchema })
  .describe(
    'Crée un artefact affiché dans le panneau de droite. Dans le fil, ne garder ensuite qu’une synthèse courte.'
  )

export const EntreeModifierArtefactSchema = z
  .strictObject({
    artefactId: IdentifiantSchema.describe(
      'Id de l’artefact à modifier (renvoyé par creer_artefact).'
    ),
    spec: ArtefactSpecSchema.describe(
      'Spécification COMPLÈTE de la nouvelle version (pas un différentiel). Le type peut changer, ex. tableau → graphique sur le même jeu.'
    ),
  })
  .describe(
    'Crée une nouvelle version d’un artefact existant ; les versions précédentes restent consultables.'
  )

const ParametresActionEntreeSchema = z
  .union([
    ParametresCreerTacheSchema,
    ParametresEnvoyerEmailSchema,
    ParametresNotifierSchema,
    ParametresProgrammerRapportSchema,
  ])
  .describe(
    'Paramètres du type choisi : creer_tache {titre, description?, assigneA, echeance?, priorite?, lien?} ; envoyer_email {artefactId, destinataires, formats, message?} ; notifier {destinataires, message, artefactId?} ; programmer_rapport {artefactId, frequence, jourSemaine?, jourMois?, heure, destinataires, formats}.'
  )

export const EntreeProposerActionSchema = z
  .strictObject({
    type: TypeActionSchema,
    parametres: ParametresActionEntreeSchema,
  })
  .superRefine((entree, ctx) => {
    const verif = SCHEMAS_PARAMETRES_ACTION[entree.type].safeParse(entree.parametres)
    if (!verif.success) {
      for (const issue of verif.error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: ['parametres', ...issue.path.map(p => (typeof p === 'symbol' ? String(p) : p))],
          message: `Paramètres incompatibles avec le type ${entree.type} : ${issue.message}`,
        })
      }
    }
  })
  .describe(
    'Propose une action à l’utilisateur. Rien n’est exécuté : une carte de confirmation s’affiche et l’utilisateur décide. Ne jamais affirmer que l’action est faite.'
  )

export const EntreeProposerRelancesSchema = z
  .strictObject({
    questions: z
      .array(
        texteSurSchema(
          200,
          'Question de relance, formulée comme l’utilisateur la poserait, dans sa langue.'
        )
      )
      .min(1)
      .max(LIMITES.relancesMax)
      .describe('Une à trois questions de suite pertinentes, affichées en boutons.'),
  })
  .describe('Propose jusqu’à trois questions de relance, à la fin d’une réponse.')

export const EntreePreparerAlerteSchema = z
  .strictObject({
    type: z
      .enum(TYPES_REGLE)
      .describe(
        'Type d’alerte automatique : AMM_CHANGEMENT_ETAPE, AMM_DECISION, AMM_ETAPE_EN_RETARD, VISA_EXPIRATION, REALISATION_BUDGET, VENTES_SEUIL, EVOLUTION_N1, STOCK_SEUIL, SAISIE_MANQUANTE ou MEP_MISE_EN_PLACE.'
      ),
    parametres: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Paramètres du type, seulement ceux demandés par l’utilisateur (ex. paysIds, produitIds, seuilPourcent, seuil, joursAvant, joursMax, comparaison, mesure, periode). Les ids viennent de rechercher_entites. Un paramètre inconnu ou invalide est refusé.'
      ),
  })
  .describe(
    'Prépare un lien pré-rempli vers l’assistant de création d’alerte (Mes alertes). Ne crée rien : l’utilisateur valide lui-même dans le formulaire.'
  )

/** Schéma d'entrée de chaque outil, pour `tool({ inputSchema })`. */
export const SCHEMAS_ENTREE_OUTILS = {
  catalogue_donnees: EntreeCatalogueDonneesSchema,
  rechercher_entites: EntreeRechercherEntitesSchema,
  interroger_donnees: EntreeInterrogerDonneesSchema,
  requete_sql: EntreeRequeteSqlSchema,
  resume_mensuel: EntreeResumeMensuelSchema,
  lire_piece_jointe: EntreeLirePieceJointeSchema,
  creer_artefact: EntreeCreerArtefactSchema,
  modifier_artefact: EntreeModifierArtefactSchema,
  proposer_action: EntreeProposerActionSchema,
  proposer_relances: EntreeProposerRelancesSchema,
  preparer_alerte: EntreePreparerAlerteSchema,
} as const satisfies Record<NomOutil, z.ZodType>

export type EntreesOutils = { [K in NomOutil]: z.infer<(typeof SCHEMAS_ENTREE_OUTILS)[K]> }
export type EntreeOutil<K extends NomOutil> = EntreesOutils[K]

export type EntreeCatalogueDonnees = EntreesOutils['catalogue_donnees']
export type EntreeRechercherEntites = EntreesOutils['rechercher_entites']
export type EntreeInterrogerDonnees = EntreesOutils['interroger_donnees']
export type EntreeRequeteSql = EntreesOutils['requete_sql']
export type EntreeResumeMensuel = EntreesOutils['resume_mensuel']
export type EntreeLirePieceJointe = EntreesOutils['lire_piece_jointe']
export type EntreeCreerArtefact = EntreesOutils['creer_artefact']
export type EntreeModifierArtefact = EntreesOutils['modifier_artefact']
export type EntreeProposerAction = EntreesOutils['proposer_action']
export type EntreeProposerRelances = EntreesOutils['proposer_relances']
export type EntreePreparerAlerte = EntreesOutils['preparer_alerte']

// ---------------------------------------------------------------------------
// Sorties
// ---------------------------------------------------------------------------

/** Codes d'erreur d'outil, renvoyés au modèle pour qu'il corrige sa demande. */
export const CODES_ERREUR_OUTIL = [
  'entree_invalide',
  'introuvable',
  'acces_refuse',
  'jeu_inconnu',
  'mesure_inconnue',
  'filtre_inconnu',
  'periode_non_close',
  'sql_refuse',
  'sql_erreur',
  'delai_depasse',
  'piece_jointe_illisible',
  /** Trop de calculs lourds (requete_sql) en peu de temps pour cet utilisateur. */
  'limite_debit_donnees',
  'interne',
] as const
export type CodeErreurOutil = (typeof CODES_ERREUR_OUTIL)[number]

/**
 * Erreur prévisible d'un outil. `message` est court, exploitable par le modèle, et
 * ne révèle ni schéma de base, ni chemin, ni donnée hors périmètre.
 */
export interface ErreurOutil {
  erreur: { code: CodeErreurOutil; message: string }
}

export function estErreurOutil(valeur: unknown): valeur is ErreurOutil {
  if (typeof valeur !== 'object' || valeur === null || !('erreur' in valeur)) return false
  const erreur = (valeur as { erreur: unknown }).erreur
  return typeof erreur === 'object' && erreur !== null && 'code' in erreur && 'message' in erreur
}

/** Une entité retrouvée par rechercher_entites. */
export interface EntiteTrouvee {
  id: string
  type: TypeEntite
  libelle: string
  code?: string
  /** Précision affichable (pays d'un grossiste, laboratoire d'un produit...). */
  detail?: string
}

/** Synthèse de chargerRevueMensuelle, en euros, pour le modèle. */
export interface ResumeMensuel {
  /** Mois résumé, `YYYY-MM`. */
  periode: string
  /** Exercice (année de début) auquel appartient le mois. */
  exercice: number
  dernierMoisClos: string
  perimetre: { libelle: string; pays: string[] }
  /** Montants en EUR, taux en points de pourcentage. */
  mois: { realise: number; budget: number; realiseN1: number; tauxRealisation: number | null }
  cumul: {
    realise: number
    budget: number
    realiseN1: number
    budgetAnnuel: number
    tauxRealisation: number | null
  }
  prevision: { total: number; bas: number; haut: number }
  completude: { agencesAttendues: number; agencesSaisies: number; dateLimite: string }
  /** Alertes les plus fortes, avec les noms (pays, produit). */
  alertes: Array<{
    type: 'rupture' | 'decrochage' | 'commandes' | 'saisie'
    gravite: 'critique' | 'attention' | 'info'
    libelle: string
  }>
  /** Plus forts écarts au budget par pays (cumul de l'exercice). */
  ecartsPays: Array<{ pays: string; realise: number; budget: number; ecart: number }>
  mouvements: {
    hausses: Array<{ pays: string; produit: string; valeur: number; valeurN1: number }>
    baisses: Array<{ pays: string; produit: string; valeur: number; valeurN1: number }>
  }
  provenance: Provenance
}

/** Contenu d'une pièce jointe lue. */
export interface ContenuPieceJointe {
  pieceJointeId: string
  nom: string
  nature: 'tableau' | 'texte'
  /** Feuilles d'un classeur, pour en choisir une autre. */
  feuilles?: string[]
  /** Texte extrait (PDF, txt), tronqué si besoin. */
  texte?: string
  /** Contenu tabulaire, enregistré comme jeu de données (source piece_jointe). */
  resultat?: ResultatJeu
  tronque: boolean
}

export interface ArtefactCree {
  artefactId: string
  version: number
  type: TypeArtefact
  titre: string
}

export interface ActionEnregistree {
  actionId: string
  type: TypeAction
  statut: Extract<StatutAction, 'proposee'>
  /** Résumé lisible, avec les noms des destinataires et de l'artefact. */
  resume: string
}

/** Noms des entités retenues d'un paramètre de l'alerte (jamais d'identifiant). */
export interface NomsEntitesAlerte {
  /** Dix noms au plus, dans l'ordre du résolveur. */
  noms: string[]
  /** Nombre d'entités retenues au-delà des noms listés (« et N autres »). */
  autres: number
}

/** Lien pré-rempli vers l'assistant de création d'alerte : rien n'est créé. */
export interface AlertePreparee {
  type: (typeof TYPES_REGLE)[number]
  /** Libellé du type d'alerte (français), pour le résumé. */
  libelleType?: string
  /** Chemin interne `/notifications/alertes/nouvelle?...` (jamais une adresse externe). */
  url: string
  /** Résumé lisible, avec les noms des pays (jamais d'identifiant). */
  resume: string
  /** Paramètres validés portés par l'adresse. */
  parametres: Record<string, unknown>
  /** Nombre de pays demandés mais écartés (hors périmètre ou inexistants). */
  paysEcartes?: number
  /**
   * Noms des entités retenues, par paramètre (`paysIds`, `grossisteIds`, `agenceIds`). Les
   * produits ne sont pas relus : la carte n'en affiche que le nombre.
   */
  entites?: Partial<Record<'paysIds' | 'grossisteIds' | 'agenceIds', NomsEntitesAlerte>>
}

/** Type de sortie de chaque outil (en cas de succès). */
export interface SortiesOutils {
  catalogue_donnees: DescriptionJeu
  rechercher_entites: EntiteTrouvee[]
  interroger_donnees: ResultatJeu
  requete_sql: ResultatJeu
  resume_mensuel: ResumeMensuel
  lire_piece_jointe: ContenuPieceJointe
  creer_artefact: ArtefactCree
  modifier_artefact: ArtefactCree
  proposer_action: ActionEnregistree
  proposer_relances: { questions: string[] }
  preparer_alerte: AlertePreparee
}
export type SortieOutil<K extends NomOutil> = SortiesOutils[K]

/**
 * Forme « UITools » du SDK : entrée et sortie de chaque outil, telles qu'elles
 * apparaissent dans les parties `tool-<nom>` des messages persistés.
 */
export type OutilsMedicAssist = {
  [K in NomOutil]: { input: EntreesOutils[K]; output: SortiesOutils[K] | ErreurOutil }
}
