/**
 * Types cote client de l'interface de chat.
 *
 * Les messages sont decrits de facon STRUCTURELLE (sans importer `ai`) pour que
 * les composants se testent sans le SDK : un `UIMessage` du SDK v7 y est
 * assignable. Seul `use-medic-chat.ts` importe `@ai-sdk/react` et `ai`.
 *
 * Les DTO reels des API de conversations (contrats/api.ts) sont convertis vers
 * ces types internes dans `api.ts`, seul endroit qui connait leur forme.
 */

import type {
  ActionProposee,
  ContexteEcran,
  ResultatJeu,
  TypeArtefact,
} from '@/lib/medic-assist/contrats'

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

export type EtatOutil = 'input-streaming' | 'input-available' | 'output-available' | 'output-error'

export interface PartieTexte {
  type: 'text'
  text: string
  state?: 'streaming' | 'done'
}

export interface PartieRaisonnement {
  type: 'reasoning'
  text: string
}

/** Partie d'outil du SDK v7 : `type` vaut `tool-<nom>`. */
export interface PartieOutil {
  type: `tool-${string}`
  toolCallId: string
  state: EtatOutil
  input?: unknown
  output?: unknown
  errorText?: string
}

export interface PartieAutre {
  type: string
  [cle: string]: unknown
}

export type PartieMessage = PartieTexte | PartieRaisonnement | PartieOutil | PartieAutre

export interface MessageUI {
  id: string
  role: 'user' | 'assistant' | 'system'
  parts: PartieMessage[]
  metadata?: unknown
}

export type StatutChat = 'submitted' | 'streaming' | 'ready' | 'error'

/** Noms d'outils figes (architecture §4). */
export const OUTILS = {
  catalogue: 'catalogue_donnees',
  entites: 'rechercher_entites',
  interroger: 'interroger_donnees',
  sql: 'requete_sql',
  resume: 'resume_mensuel',
  pieceJointe: 'lire_piece_jointe',
  creerArtefact: 'creer_artefact',
  modifierArtefact: 'modifier_artefact',
  action: 'proposer_action',
  relances: 'proposer_relances',
  preparerAlerte: 'preparer_alerte',
} as const

export type NomOutil = (typeof OUTILS)[keyof typeof OUTILS]

/** Sortie de `creer_artefact` / `modifier_artefact`. */
export interface SortieArtefact {
  artefactId: string
  version: number
  type: TypeArtefact
  titre: string
}

/** Sortie de `proposer_action` : l'action est creee a l'etat `proposee`. */
export interface SortieAction {
  actionId: string
  statut: 'proposee'
  resume: string
  /** Action complete quand le serveur la renvoie (sinon reconstruite a partir du resume). */
  action?: ActionProposee
}

/** Entree de `proposer_relances`. */
export interface EntreeRelances {
  questions: string[]
}

export type SortieDonnees = ResultatJeu

/* -------------------------------------------------------------------------- */
/* Conversations (types internes ; mappage des DTO dans api.ts)               */
/* -------------------------------------------------------------------------- */

export interface ConversationResume {
  id: string
  /** Titre genere ou renomme ; null/vide tant que l'IA n'en a pas propose. */
  titre: string | null
  epinglee: boolean
  archivee: boolean
  /** ISO de la derniere activite. */
  miseAJour: string
  /** Conversation partagee AVEC moi (lecture seule). */
  partageeAvecMoi?: boolean
  /** Nom affiche de la personne qui l'a partagee. */
  partageePar?: string
}

export interface ConversationDetail extends ConversationResume {
  messages: MessageUI[]
  /** Identifiants des artefacts de la conversation, du plus ancien au plus recent. */
  artefactIds?: string[]
  lectureSeule?: boolean
}

/** Pouce haut / bas (POST /api/medic-assist/messages/[id]/avis). */
export type ValeurAvis = 'positif' | 'negatif'

/** Piece jointe envoyee (POST /api/medic-assist/pieces-jointes, lot 6). */
export interface PieceJointe {
  id: string
  nom: string
  taille?: number
}

/** Ce que la zone de saisie remet a la page a l'envoi. */
export interface EnvoiMessage {
  texte: string
  modeProfond: boolean
  piecesJointes: PieceJointe[]
  /** Contexte d'ecran joint (absent si l'utilisateur a retire la puce). */
  contexteEcran?: ContexteEcran
}

/** Langue de reconnaissance/synthese vocale (BCP 47) pour chaque langue de l'interface. */
export const LANGUES_VOIX: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
  zh: 'zh-CN',
  ar: 'ar-SA',
  hi: 'hi-IN',
}
