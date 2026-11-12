/**
 * Types du suivi de Medic Assist (lot 5) : lignes renvoyees par le depot et
 * formes JSON des routes. Sans dependance Prisma : le depot (voir depot.ts) est
 * la seule couche qui parle aux tables Assistant*.
 */

import type { Locale } from '@/i18n/config'
import type {
  FormatEnvoi,
  FrequenceRapport,
  ResultatAction,
  StatutAction,
  TypeAction,
} from '@/lib/medic-assist/contrats'

/** Compte MedicPro actif qui a acces a Medic Assist (destinataire possible). */
export interface CompteResume {
  id: string
  /** « Prenom Nom » : c'est ce qui s'affiche, jamais l'identifiant. */
  nom: string
  email: string
  locale: Locale
}

/** Compte actif destinataire d'une notification, avec ou sans acces a Medic Assist. */
export interface CompteNotifiable extends CompteResume {
  /** Vrai si le compte peut utiliser Medic Assist (donc ouvrir un artefact partage). */
  aAcces: boolean
}

/** Un artefact vu par un utilisateur (proprietaire ou destinataire d'un partage). */
export interface ArtefactVisible {
  id: string
  titre: string
  /** 'tableau' | 'graphique' | 'indicateurs' | 'document'. */
  type: string
  sousTitre: string | null
  conversationId: string
  proprietaireId: string
}

export interface ConversationResume {
  id: string
  titre: string
}

// --------------------------------------------------------------------------- actions

export interface ActionRow {
  id: string
  userId: string
  /** Obligatoire en base (AssistantAction.conversationId). */
  conversationId: string
  type: TypeAction
  statut: StatutAction
  /** JSON valide par SCHEMAS_PARAMETRES_ACTION[type] a la creation. */
  parametres: unknown
  resume: string
  /** Resultat au format du contrat ; en cas d'echec, resultat.erreur porte le code court. */
  resultat: ResultatAction | null
  creeA: Date
  /** Date de traitement : execution, echec ou annulation (devient traiteeA dans l'API). */
  executeeA: Date | null
}

export interface NouvelleAction {
  userId: string
  conversationId: string
  type: TypeAction
  parametres: unknown
  resume: string
}

// --------------------------------------------------------------------------- analyses et epingles

export interface AnalyseResume {
  artefactId: string
  titre: string
  type: string
  sousTitre: string | null
  conversationId: string
  enregistreeA: Date
  /** Vrai si l'artefact appartient a quelqu'un d'autre (partage). */
  partage: boolean
}

export interface EpingleResume {
  artefactId: string
  titre: string
  type: string
  conversationId: string
  ordre: number
  epingleeA: Date
}

// --------------------------------------------------------------------------- partages

export type TypeCiblePartage = 'conversation' | 'artefact'

export interface NouveauPartage {
  expediteurId: string
  destinataireId: string
  cibleType: TypeCiblePartage
  cibleId: string
  message: string | null
}

export interface PartageRecu {
  id: string
  cibleType: TypeCiblePartage
  cibleId: string
  titre: string
  /** Pour une cible 'artefact' : sa conversation (lien d'ouverture). */
  conversationId: string | null
  expediteurNom: string
  message: string | null
  creeA: Date
}

export interface PartageEnvoye {
  id: string
  cibleType: TypeCiblePartage
  cibleId: string
  titre: string
  destinataireNom: string
  creeA: Date
}

// --------------------------------------------------------------------------- rapports programmes

export interface RapportProgrammeRow {
  id: string
  userId: string
  artefactId: string
  /** Titre de l'artefact, pour l'affichage. */
  artefactTitre: string
  frequence: FrequenceRapport
  /** 1 = lundi ... 7 = dimanche ; renseigne si frequence = 'hebdomadaire'. */
  jourSemaine: number | null
  /** 1 a 28 ; renseigne si frequence = 'mensuel'. */
  jourMois: number | null
  /** 'HH:mm', heure de Paris. */
  heure: string
  destinataires: string[]
  formats: FormatEnvoi[]
  actif: boolean
  prochainEnvoiA: Date | null
  dernierEnvoiA: Date | null
  dernierStatut: 'ok' | 'partiel' | 'echec' | null
  derniereErreur: string | null
  creeA: Date
}

export interface NouveauRapportProgramme {
  userId: string
  artefactId: string
  frequence: FrequenceRapport
  jourSemaine: number | null
  jourMois: number | null
  /** 'HH:mm', heure de Paris. */
  heure: string
  destinataires: string[]
  formats: FormatEnvoi[]
  prochainEnvoiA: Date
}

export type ModificationRapportProgramme = Partial<
  Pick<
    RapportProgrammeRow,
    | 'frequence'
    | 'jourSemaine'
    | 'jourMois'
    | 'heure'
    | 'destinataires'
    | 'formats'
    | 'actif'
    | 'prochainEnvoiA'
  >
>

export interface ResultatEnvoiRapport {
  dernierEnvoiA: Date
  statut: 'ok' | 'partiel' | 'echec'
  erreur: string | null
}

// --------------------------------------------------------------------------- formes JSON des routes

/** Un compte dans le selecteur d'utilisateurs. */
export interface CompteJson {
  id: string
  nom: string
  email: string
}

export interface TacheJson {
  id: string
  titre: string
  description: string | null
  priorite: 'basse' | 'normale' | 'haute'
  /** ISO ou null. */
  echeance: string | null
  /** Calcule cote serveur avec l'horloge du serveur. */
  etat: 'a_faire' | 'en_retard' | 'terminee'
  terminee: boolean
  termineeLe: string | null
  /** Nom de la personne assignee. */
  assigneeNom: string
  /** Nom de la personne qui a cree la tache via l'assistant, si connu. */
  creeParNom: string | null
  /** Vrai si la tache m'est assignee (je peux la marquer terminee). */
  assigneeAMoi: boolean
  /** Conversation d'origine, si connue (lien /medic-assist?c=...). */
  conversationId: string | null
  /**
   * Vrai seulement si `conversationId` est present ET que la conversation appartient
   * au lecteur (il est le createur de la tache). L'ecran n'affiche « Voir la
   * conversation » que dans ce cas.
   */
  conversationOuvrable: boolean
  creeLe: string
}
