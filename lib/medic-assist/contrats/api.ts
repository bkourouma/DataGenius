/**
 * DTO des API de Medic Assist (§4, chemins figés) et schémas zod des corps de
 * requête. Les réponses sont des DTO JSON : dates en ISO 8601 (chaînes), personnes
 * avec leur nom (jamais l'id seul à l'écran), aucune clé d'API nulle part.
 *
 * Chaque route appelle exigerMedicAssist() ou exigerAdminMedicAssist() (§3) et
 * valide son corps avec le schéma ci-dessous (`safeParse`, 400 sinon, au format
 * ErreurApi).
 */

import type { NombreAnalytique } from '@/lib/medic-assist/contrats/numerique'
import { z } from 'zod'

import {
  ParametresCreerTacheSchema,
  ParametresEnvoyerEmailSchema,
  ParametresNotifierSchema,
  ParametresProgrammerRapportSchema,
  type ActionProposee,
  type PrioriteTache,
} from '@/lib/medic-assist/contrats/actions'
import { ArtefactSpecSchema, type ArtefactSpec } from '@/lib/medic-assist/contrats/artefacts'
import {
  DateCivileSchema,
  IdentifiantSchema,
  texteMultiligneSurSchema,
  texteSurSchema,
  type LigneJeu,
  type PersonneDto,
} from '@/lib/medic-assist/contrats/communs'
import {
  FORMATS_ENVOI,
  FORMATS_EXPORT,
  FOURNISSEURS,
  FOURNISSEURS_TRANSCRIPTION,
  FREQUENCES_RAPPORT,
  LIMITES,
  MODES,
  VALEURS_AVIS,
  type FormatEnvoi,
  type Fournisseur,
  type FournisseurTranscription,
  type FrequenceRapport,
  type Mode,
  type ModeLangage,
  type TypeArtefact,
  type ValeurAvis,
} from '@/lib/medic-assist/contrats/constantes'
import type { ColonneJeu, Provenance } from '@/lib/medic-assist/contrats/donnees'
import type { MessagePersiste } from '@/lib/medic-assist/contrats/chat'

// ---------------------------------------------------------------------------
// Briques des requêtes
// ---------------------------------------------------------------------------

/** Entier passé en paramètre d'URL (`?page=2`). */
const entierQuery = (min: number, max: number) => z.coerce.number().int().min(min).max(max)

/** Booléen passé en paramètre d'URL : « 1 » / « true » vrai, « 0 » / « false » faux. */
const booleenQuery = z.enum(['1', '0', 'true', 'false']).transform(v => v === '1' || v === 'true')

const titreConversationSchema = texteSurSchema(
  LIMITES.longueurMaxTitre,
  'Titre de la conversation.'
)

const paginationListeQuery = {
  curseur: z.string().max(200).optional(),
  taille: entierQuery(1, LIMITES.taillePageListeMax).optional(),
}

// ---------------------------------------------------------------------------
// Conversations (lot 1)
// GET|POST /api/medic-assist/conversations, GET|PATCH|DELETE .../conversations/[id]
// ---------------------------------------------------------------------------

export const ListeConversationsQuerySchema = z.object({
  recherche: z.string().max(200).optional(),
  /** true : les archivées seulement ; absent : les non archivées. */
  archivees: booleenQuery.optional(),
  ...paginationListeQuery,
})
export type ListeConversationsQuery = z.infer<typeof ListeConversationsQuerySchema>

export interface ConversationResumeDto {
  id: string
  titre: string
  epinglee: boolean
  archivee: boolean
  /** Horodatage du dernier message (tri de la liste). */
  dernierMessageA: string
  creeA: string
  /** Vrai si le propriétaire l'a partagée avec au moins une personne. */
  partagee?: boolean
  nbMessages?: number
}

/** Conversation partagée avec le lecteur (section « Partagées avec moi »). */
export interface ConversationPartageeDto extends ConversationResumeDto {
  partageId: string
  proprietaire: PersonneDto
  partageeA: string
}

export interface ListeConversationsDto {
  /** Épinglées en tête, puis par dernierMessageA décroissant. */
  conversations: ConversationResumeDto[]
  partageesAvecMoi: ConversationPartageeDto[]
  suivant: string | null
}

export const CreerConversationCorpsSchema = z.object({
  titre: titreConversationSchema.optional(),
})
export type CreerConversationCorps = z.infer<typeof CreerConversationCorpsSchema>

export const ModifierConversationCorpsSchema = z
  .object({
    titre: titreConversationSchema.optional(),
    epinglee: z.boolean().optional(),
    archivee: z.boolean().optional(),
  })
  .refine(c => c.titre !== undefined || c.epinglee !== undefined || c.archivee !== undefined, {
    error: 'Au moins un champ à modifier : titre, epinglee ou archivee.',
  })
export type ModifierConversationCorps = z.infer<typeof ModifierConversationCorpsSchema>

/** Artefact cité dans une conversation (onglets du panneau). */
export interface ArtefactResumeDto {
  id: string
  type: TypeArtefact
  titre: string
  version: number
  majA: string
}

export interface ConversationDetailDto {
  id: string
  titre: string
  epinglee: boolean
  archivee: boolean
  creeA: string
  dernierMessageA: string
  /** Messages au format persisté (parties UIMessage + métadonnées), du plus ancien au plus récent. */
  messages: MessagePersiste[]
  artefacts: ArtefactResumeDto[]
  actions: ActionProposee[]
  /** Vrai quand le lecteur n'est pas le propriétaire (partage) : ni saisie ni action. */
  lectureSeule: boolean
  proprietaire: PersonneDto
}

// ---------------------------------------------------------------------------
// Avis (lot 1) : POST /api/medic-assist/messages/[id]/avis
// ---------------------------------------------------------------------------

export const AvisCorpsSchema = z.object({
  /** null retire l'avis. */
  valeur: z.enum(VALEURS_AVIS).nullable(),
  commentaire: texteMultiligneSurSchema(1_000, 'Commentaire facultatif.').optional(),
})
export type AvisCorps = z.infer<typeof AvisCorpsSchema>

export interface AvisDto {
  messageId: string
  valeur: ValeurAvis | null
  commentaire?: string
  majA: string
}

// ---------------------------------------------------------------------------
// Jeux de données (lot 2) : GET /api/medic-assist/jeux/[id]?recalculer=1&page&taille
// ---------------------------------------------------------------------------

export const JeuQuerySchema = z.object({
  recalculer: booleenQuery.optional(),
  /** Page, à partir de 1. */
  page: entierQuery(1, 100_000).optional(),
  taille: entierQuery(1, LIMITES.taillePageJeuMax).optional(),
})
export type JeuQuery = z.infer<typeof JeuQuerySchema>

export interface JeuPagineDto {
  jeuDeDonneesId: string
  colonnes: ColonneJeu[]
  lignes: LigneJeu[]
  page: number
  taille: number
  /** Lignes du jeu (après plafond de stockage). */
  total: number
  tronque: boolean
  totaux?: Record<string, NombreAnalytique>
  /** Provenance ; `sql` n'est présent que pour un administrateur. */
  provenance: Provenance
  calculeA: string
  /** Vrai si le jeu vient d'être recalculé dans le périmètre du lecteur. */
  recalcule: boolean
}

// ---------------------------------------------------------------------------
// Artefacts (lot 4) : GET|PATCH /api/medic-assist/artefacts/[id], .../export
// ---------------------------------------------------------------------------

export const ArtefactQuerySchema = z.object({
  /** Version à lire ; absente : la dernière. */
  version: entierQuery(1, 10_000).optional(),
})

/** PATCH : soit une nouvelle spécification (nouvelle version), soit la restauration d'une version. */
export const ModifierArtefactCorpsSchema = z.union([
  z.strictObject({
    spec: ArtefactSpecSchema,
    /** Version sur laquelle l'édition s'appuie : 409 si une version plus récente existe. */
    versionAttendue: z.number().int().min(1).optional(),
  }),
  z.strictObject({ restaurerVersion: z.number().int().min(1) }),
])
export type ModifierArtefactCorps = z.infer<typeof ModifierArtefactCorpsSchema>

export const ExportArtefactQuerySchema = z.object({
  format: z.enum(FORMATS_EXPORT),
  version: entierQuery(1, 10_000).optional(),
})
export type ExportArtefactQuery = z.infer<typeof ExportArtefactQuerySchema>

export interface JeuLieDto {
  jeuDeDonneesId: string
  colonnes: ColonneJeu[]
  nbLignes: number
  tronque: boolean
  provenance: Provenance
  calculeA: string
}

export interface VersionArtefactDto {
  version: number
  titre: string
  type: TypeArtefact
  creeA: string
  /** Auteur : l'assistant ou l'utilisateur (édition dans le panneau). */
  auteur: 'assistant' | 'utilisateur'
}

export interface DroitsArtefactDto {
  lecture: true
  modification: boolean
  partage: boolean
  export: boolean
  programmation: boolean
}

export interface ArtefactDto {
  id: string
  /** null quand la conversation d'origine a été supprimée (SetNull en base). */
  conversationId: string | null
  type: TypeArtefact
  titre: string
  spec: ArtefactSpec
  version: number
  versions: VersionArtefactDto[]
  /** Jeux référencés par la spécification (blocs de document compris). */
  jeux: JeuLieDto[]
  /** Enregistré dans Mes analyses par le lecteur. */
  enregistre: boolean
  /** Épinglé au tableau de bord du lecteur. */
  epingle: boolean
  droits: DroitsArtefactDto
  proprietaire: PersonneDto
  creeA: string
  majA: string
}

// ---------------------------------------------------------------------------
// Mes analyses (lot 5) : GET|POST /api/medic-assist/analyses, DELETE .../analyses/[id]
// ---------------------------------------------------------------------------

/**
 * Réponses du suivi (lot 5) : `{ data }` pour un objet ou une liste, `{ data, total }`
 * pour les listes paginées (`?page=&taille=`, taille 50 par défaut, 200 au plus).
 */
export interface EnveloppeDonnees<T> {
  data: T
}
export interface EnveloppeListePaginee<T> {
  data: T[]
  total: number
}
/** POST analyses | épingles : 201 si créé, 200 si déjà présent (idempotent). */
export interface EnregistrementIdempotentDto {
  artefactId: string
  cree: boolean
}
/** DELETE partages | rapports-programmes | épingles. */
export interface ConfirmationOkDto {
  ok: true
}

/** POST /api/medic-assist/analyses : l'artefact doit appartenir au lecteur. */
export const CreerAnalyseCorpsSchema = z.object({
  artefactId: IdentifiantSchema,
})
export type CreerAnalyseCorps = z.infer<typeof CreerAnalyseCorpsSchema>

/** GET /api/medic-assist/analyses?q=&artefactId=&page=&taille= */
export interface AnalyseDto {
  artefactId: string
  titre: string
  type: TypeArtefact
  sousTitre: string | null
  /** '' quand la conversation d'origine n'existe plus. */
  conversationId: string
  /** ISO 8601. */
  enregistreeLe: string
  /** Toujours faux : seuls les artefacts du propriétaire sont enregistrables. */
  partage: boolean
}

// ---------------------------------------------------------------------------
// Partages (lot 5) : POST|GET /api/medic-assist/partages
// ---------------------------------------------------------------------------

export const OBJETS_PARTAGE = ['conversation', 'artefact'] as const
export type ObjetPartage = (typeof OBJETS_PARTAGE)[number]

export const CreerPartageCorpsSchema = z.object({
  objet: z.enum(OBJETS_PARTAGE),
  objetId: IdentifiantSchema,
  destinataires: z.array(IdentifiantSchema).min(1).max(LIMITES.destinatairesMax),
  message: texteMultiligneSurSchema(LIMITES.longueurMaxMessageAction, 'Mot facultatif.').optional(),
})
export type CreerPartageCorps = z.infer<typeof CreerPartageCorpsSchema>

/** GET /api/medic-assist/partages?sens=recus|envoyes&page=&taille= */
export const ListePartagesQuerySchema = z.object({
  /** recus : partagés avec moi (défaut) ; envoyes : ceux que j'ai faits. */
  sens: z.enum(['recus', 'envoyes']).optional(),
  page: entierQuery(1, 100_000).optional(),
  taille: entierQuery(1, 200).optional(),
})
export type ListePartagesQuery = z.infer<typeof ListePartagesQuerySchema>

/** POST /api/medic-assist/partages → 201 { data: PartageCreeDto }. */
export interface PartageCreeDto {
  /** Nombre de partages créés (un par destinataire retenu). */
  partages: number
}

export interface PartageRecuDto {
  id: string
  cibleType: ObjetPartage
  cibleId: string
  titre: string
  /** Conversation d'ouverture ; null si elle n'existe plus. */
  conversationId: string | null
  expediteurNom: string
  message: string | null
  /** ISO 8601. */
  creeLe: string
}

export interface PartageEnvoyeDto {
  id: string
  cibleType: ObjetPartage
  cibleId: string
  titre: string
  destinataireNom: string
  /** ISO 8601. */
  creeLe: string
}

/** GET /api/medic-assist/partages/droits?artefactId= */
export interface DroitsPartageDto {
  /** Vrai : le lecteur peut partager, envoyer, notifier ou programmer l'artefact. */
  proprietaire: boolean
}

// ---------------------------------------------------------------------------
// Épingles (lot 5) : GET|POST|DELETE /api/medic-assist/epingles
// ---------------------------------------------------------------------------

export const CreerEpingleCorpsSchema = z.object({
  artefactId: IdentifiantSchema,
})
export type CreerEpingleCorps = z.infer<typeof CreerEpingleCorpsSchema>

/** DELETE /api/medic-assist/epingles?artefactId=... */
export const SupprimerEpingleQuerySchema = z.object({ artefactId: IdentifiantSchema })

/** GET /api/medic-assist/epingles[?artefactId=] : épingles du lecteur, dans l'ordre d'affichage. */
export interface EpingleDto {
  artefactId: string
  titre: string
  type: TypeArtefact
  /** '' quand la conversation d'origine n'existe plus. */
  conversationId: string
  ordre: number
  /** ISO 8601. */
  epingleeLe: string
}

// ---------------------------------------------------------------------------
// Rapports programmés (lot 5) : GET|POST|PATCH|DELETE /api/medic-assist/rapports-programmes(/[id])
// ---------------------------------------------------------------------------

export const CreerRapportProgrammeCorpsSchema = ParametresProgrammerRapportSchema
export type CreerRapportProgrammeCorps = z.infer<typeof CreerRapportProgrammeCorpsSchema>

export const ModifierRapportProgrammeCorpsSchema = z
  .object({
    frequence: z.enum(FREQUENCES_RAPPORT).optional(),
    jourSemaine: z.number().int().min(1).max(7).nullable().optional(),
    jourMois: z.number().int().min(1).max(28).nullable().optional(),
    heure: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    destinataires: z.array(IdentifiantSchema).min(1).max(LIMITES.destinatairesMax).optional(),
    formats: z.array(z.enum(FORMATS_ENVOI)).min(1).max(FORMATS_ENVOI.length).optional(),
    actif: z.boolean().optional(),
  })
  .refine(c => Object.values(c).some(v => v !== undefined), {
    error: 'Au moins un champ à modifier.',
  })
export type ModifierRapportProgrammeCorps = z.infer<typeof ModifierRapportProgrammeCorpsSchema>

export interface RapportProgrammeDto {
  id: string
  artefactId: string
  artefactTitre: string
  frequence: FrequenceRapport
  jourSemaine: number | null
  jourMois: number | null
  heure: string
  /** Nom affiché ; '' si le compte n'existe plus ou n'a plus accès. */
  destinataires: Array<{ id: string; nom: string }>
  formats: FormatEnvoi[]
  actif: boolean
  prochainEnvoiA: string | null
  dernierEnvoiA: string | null
  dernierStatut: 'ok' | 'partiel' | 'echec' | null
  derniereErreur: string | null
  creeLe: string
}

// ---------------------------------------------------------------------------
// Actions (lot 5) : POST /api/medic-assist/actions/[id]/confirmer | annuler
// ---------------------------------------------------------------------------

/**
 * Confirmer : corps vide, ou paramètres retouchés par l'utilisateur sur la carte
 * (même type que l'action ; revalidés et droits revérifiés au clic).
 */
export const ConfirmerActionCorpsSchema = z.object({
  parametres: z
    .union([
      ParametresCreerTacheSchema,
      ParametresEnvoyerEmailSchema,
      ParametresNotifierSchema,
      ParametresProgrammerRapportSchema,
    ])
    .optional(),
})
export type ConfirmerActionCorps = z.infer<typeof ConfirmerActionCorpsSchema>

/** Réponse de confirmer et d'annuler : l'action à jour. */
export type ActionDto = ActionProposee

// ---------------------------------------------------------------------------
// Tâches (lot 5) : GET|PATCH /api/medic-assist/taches (modèle Task)
// ---------------------------------------------------------------------------

export const STATUTS_TACHE = ['a_faire', 'en_cours', 'terminee', 'annulee'] as const
export type StatutTache = (typeof STATUTS_TACHE)[number]

/** Valeurs de Task.status en base (défaut « pending »). Recommandation lot 0. */
export const STATUT_TACHE_EN_BASE: Record<StatutTache, string> = {
  a_faire: 'pending',
  en_cours: 'in_progress',
  terminee: 'completed',
  annulee: 'cancelled',
}

export const ETATS_TACHE = ['a_faire', 'en_retard', 'terminee'] as const
export type EtatTache = (typeof ETATS_TACHE)[number]

/** GET /api/medic-assist/taches?etat= */
export const ListeTachesQuerySchema = z.object({
  etat: z.enum(ETATS_TACHE).optional(),
})

/** PATCH /api/medic-assist/taches : marque terminée, ou rouvre (la tâche doit m'être assignée). */
export const ModifierTacheCorpsSchema = z.object({
  id: IdentifiantSchema,
  terminee: z.boolean(),
})
export type ModifierTacheCorps = z.infer<typeof ModifierTacheCorpsSchema>

export interface TacheDto {
  id: string
  titre: string
  description: string | null
  priorite: PrioriteTache
  /** ISO 8601 ou null. */
  echeance: string | null
  /** Calculé côté serveur avec l'horloge du serveur. */
  etat: EtatTache
  terminee: boolean
  termineeLe: string | null
  /** Nom de la personne assignée. */
  assigneeNom: string
  /** Nom de la personne qui a créé la tâche via l'assistant, si connu. */
  creeParNom: string | null
  /** Vrai si la tâche m'est assignée. */
  assigneeAMoi: boolean
  conversationId: string | null
  /** Vrai si `conversationId` est présent ET appartient au lecteur. */
  conversationOuvrable: boolean
  creeLe: string
}

// ---------------------------------------------------------------------------
// Pièces jointes et transcription (lot 6)
// POST /api/medic-assist/pieces-jointes (multipart), POST /api/medic-assist/transcription
// ---------------------------------------------------------------------------

/** Noms des champs des formulaires multipart. */
export const CHAMPS_TELEVERSEMENT = {
  fichier: 'fichier',
  conversationId: 'conversationId',
  audio: 'audio',
  langue: 'langue',
} as const

export interface PieceJointeDto {
  id: string
  nom: string
  extension: (typeof LIMITES.extensionsPiecesJointes)[number]
  tailleOctets: number
  typeMime: string
  conversationId: string | null
  /** Feuilles d'un classeur Excel. */
  feuilles?: string[]
  /** Pages d'un PDF. */
  pages?: number
  creeA: string
}

export interface TranscriptionDto {
  texte: string
  langue?: string
  dureeSecondes?: number
}

// ---------------------------------------------------------------------------
// Administration (lot 6) : GET|PUT .../admin/config, GET .../admin/usages, GET .../admin/avis
// ---------------------------------------------------------------------------

/** Modèle choisi pour chaque mode de langage. */
export type ModelesParMode = Record<ModeLangage, string>

/**
 * Transcription serveur : null = dictée du navigateur seulement (défaut prudent),
 * sinon le fournisseur et le modèle de transcription.
 */
export type ConfigTranscription = { fournisseur: FournisseurTranscription; modele: string } | null

/** Tarif d'un modèle, en dollars US par million de jetons. */
export interface TarifModele {
  fournisseur: Fournisseur
  modele: string
  entreeUsdParMillion: number
  sortieUsdParMillion: number
  cacheLectureUsdParMillion?: number
  cacheEcritureUsdParMillion?: number
}

export interface ConfigAdminDto {
  fournisseur: Fournisseur
  modeles: ModelesParMode
  transcription: ConfigTranscription
  /** Fournisseurs dont la clé est définie sur le serveur (jamais la clé elle-même). */
  fournisseursDisponibles: Fournisseur[]
  fournisseursTranscriptionDisponibles: FournisseurTranscription[]
  /** Modèles proposés par défaut pour chaque fournisseur (null = à choisir). */
  modelesParDefaut: Record<Fournisseur, Record<ModeLangage, string | null>>
  tarifs: TarifModele[]
  majA: string | null
  majPar: PersonneDto | null
}

const identifiantModeleSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)

export const ConfigAdminCorpsSchema = z.object({
  fournisseur: z.enum(FOURNISSEURS),
  modeles: z.object({
    standard: identifiantModeleSchema,
    profond: identifiantModeleSchema,
    rapide: identifiantModeleSchema,
  }),
  transcription: z
    .object({
      fournisseur: z.enum(FOURNISSEURS_TRANSCRIPTION),
      modele: identifiantModeleSchema,
    })
    .nullable(),
})
export type ConfigAdminCorps = z.infer<typeof ConfigAdminCorpsSchema>

export const UsagesQuerySchema = z
  .object({
    du: DateCivileSchema,
    au: DateCivileSchema,
    groupement: z.enum(['jour', 'mois']).optional(),
    utilisateurId: IdentifiantSchema.optional(),
    fournisseur: z.enum(FOURNISSEURS).optional(),
    modele: z.string().max(100).optional(),
    mode: z.enum(MODES).optional(),
  })
  .refine(q => q.du <= q.au, { error: 'du doit précéder au.' })
export type UsagesQuery = z.infer<typeof UsagesQuerySchema>

export interface AgregatUsage {
  requetes: number
  tokensEntree: number
  tokensSortie: number
  tokensCacheLecture: number
  tokensCacheEcriture: number
  coutUsd: number
}

export interface UsagesDto {
  du: string
  au: string
  totaux: AgregatUsage
  parPeriode: Array<AgregatUsage & { periode: string }>
  parUtilisateur: Array<AgregatUsage & { utilisateur: PersonneDto }>
  parModele: Array<AgregatUsage & { fournisseur: Fournisseur; modele: string }>
  parMode: Array<AgregatUsage & { mode: Mode }>
}

export const AvisAdminQuerySchema = z.object({
  valeur: z.enum(VALEURS_AVIS).optional(),
  du: DateCivileSchema.optional(),
  au: DateCivileSchema.optional(),
  ...paginationListeQuery,
})
export type AvisAdminQuery = z.infer<typeof AvisAdminQuerySchema>

export interface AvisAdminDto {
  id: string
  messageId: string
  conversationId: string
  valeur: ValeurAvis
  commentaire?: string
  utilisateur: PersonneDto
  /** Extraits (question posée, début de la réponse), pour juger sans ouvrir. */
  question?: string
  reponse?: string
  fournisseur?: Fournisseur
  modele?: string
  creeA: string
}

export interface ListeAvisAdminDto {
  avis: AvisAdminDto[]
  totaux: { positifs: number; negatifs: number }
  suivant: string | null
}
