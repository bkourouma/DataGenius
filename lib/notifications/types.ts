/**
 * Types et contrats partages du systeme d'alertes et de notifications.
 *
 * Ce fichier n'importe ni Prisma ni Node : il est charge cote client comme
 * cote serveur (import de types uniquement). Voir
 * .orchestration/2026-11-02-notifications/conception.md.
 */

import type { AccessScope } from '@/lib/auth/access-scope'

export type FamilleRegle = 'reglementaire' | 'ventes' | 'stocks' | 'saisie' | 'mep'
export type ModeEvaluation = 'evenement' | 'quotidien' | 'mensuel'
export type PrioriteNotification = 'basse' | 'normale' | 'haute'
export const PRIORITES: readonly PrioriteNotification[] = ['basse', 'normale', 'haute']
export type ModeDestinataires = 'moi' | 'profils' | 'utilisateurs'
export const MODES_DESTINATAIRES: readonly ModeDestinataires[] = ['moi', 'profils', 'utilisateurs']

export const TYPES_REGLE = [
  'AMM_CHANGEMENT_ETAPE',
  'AMM_DECISION',
  'AMM_ETAPE_EN_RETARD',
  'VISA_EXPIRATION',
  'REALISATION_BUDGET',
  'VENTES_SEUIL',
  'EVOLUTION_N1',
  'STOCK_SEUIL',
  'SAISIE_MANQUANTE',
  'MEP_MISE_EN_PLACE',
] as const
export type TypeRegle = (typeof TYPES_REGLE)[number]

/** Notification.type des notifications nees d'une regle. */
export const TYPE_NOTIFICATION_ALERTE = 'ALERTE'

/** Regle chargee depuis la base, parametres deja valides. */
export interface RegleChargee {
  id: string
  nom: string
  type: TypeRegle
  parametres: Record<string, unknown>
  priorite: PrioriteNotification
  envoyerEmail: boolean
  modeDestinataires: ModeDestinataires
  inclureCreateur: boolean
  active: boolean
  version: number
  createurId: string
  cibles: { userIds: string[]; profilIds: string[] }
}

/** Destinataire effectif, avec son perimetre. */
export interface Destinataire {
  id: string
  email: string
  prenom: string
  locale: string | null
  scope: AccessScope
}

export type UniteValeur = 'pourcent' | 'euros' | 'unites' | 'jours'

/** Une ligne d'un constat (un pays, un couple pays x produit, un dossier, un visa, une agence). */
export interface EntiteConstat {
  /** Deja lisible : « Benin », « Benin - DOLIPRANE 500 », « Agence Cotonou ». */
  libelle: string
  paysId?: string
  produitId?: string
  agenceId?: string
  /** Formatee a la redaction dans la langue du destinataire. */
  valeur?: number
  unite?: UniteValeur
  /** Ex. budget, seuil. */
  reference?: number
  uniteReference?: UniteValeur
}

/** Ce qu'un evaluateur a trouve, pret a diffuser a UN destinataire (ou a tous pour un evenement). */
export interface Constat {
  /** Partie variable de l'id deterministe ; '' pour un evenement. */
  cle: string
  /** 'YYYY-MM' pour les regles mensuelles. */
  periode?: string
  /** Au moins une. */
  entites: EntiteConstat[]
  /** Espaces reserves du gabarit de message (voir messages/<l>/notifications.json, contenu.<TYPE>.message). */
  valeurs: Record<string, string | number>
  /** Remplace le lien du catalogue. */
  lien?: string
  relatedEntityType?: string
  relatedEntityId?: string
}

export interface BilanDiffusion {
  creees: number
  dejaPresentes: number
  emailsEnvoyes: number
  emailsEchoues: number
}

export type EvenementMetier =
  | {
      type: 'AMM_CHANGEMENT_ETAPE'
      procedureId: number
      etapeDepart: string | null
      etapeArrivee: string
      paysId: string
      /** Agence de la procedure ; null = sans agence (invisible d'un compte borne a des agences). */
      agenceId: string | null
      produitId: string
      typeProcedure: string
      auteurId?: string
    }
  | {
      type: 'AMM_DECISION'
      procedureId: number
      favorable: boolean
      paysId: string
      agenceId: string | null
      produitId: string
      typeProcedure: string
      auteurId?: string
    }
  | {
      type: 'MEP_MISE_EN_PLACE'
      placementId: string
      produitId: string
      grossisteId: string
      paysId: string
      quantite: number
      datePlacement: string
      auteurId?: string
    }

/** DTO rendu par l'API des regles. */
export interface RegleNotificationDTO {
  id: string
  nom: string
  type: TypeRegle
  famille: FamilleRegle
  mode: ModeEvaluation
  parametres: Record<string, unknown>
  priorite: PrioriteNotification
  envoyerEmail: boolean
  modeDestinataires: ModeDestinataires
  inclureCreateur: boolean
  active: boolean
  createur: { id: string; nom: string }
  estCreateur: boolean
  desabonne: boolean
  profils: { id: string; nom: string }[]
  utilisateurs: { id: string; nom: string }[]
  createdAt: string
  updatedAt: string
}
