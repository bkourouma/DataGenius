/**
 * Contrat du journal d'audit (table warehouse.journal_audit). Les codes d'action sont STABLES :
 * ils sont stockés en base, filtrés par la page du journal et traduits par messages/<langue>/journal.json
 * (clé `actions.<code avec « . » remplacé par « _ »>`, ex. `actions.source_creation`).
 * Aucun secret, mot de passe, e-mail ni contenu de données n'y est stocké : l'acteur est un identifiant.
 */

export const FAMILLES_AUDIT = [
  'source', 'export', 'partage', 'connexion', 'utilisateur', 'droits', 'journal',
] as const
export type FamilleAudit = (typeof FAMILLES_AUDIT)[number]

export const ACTIONS_AUDIT = [
  'source.creation',
  'source.modification',
  'source.suppression',
  'source.synchronisation',
  'export.artefact',
  'partage.creation',
  'partage.retrait',
  'connexion.reussie',
  'connexion.echec',
  'connexion.bloquee',
  'utilisateur.invitation',
  'utilisateur.invitation_renvoyee',
  'utilisateur.role_modifie',
  'utilisateur.desactivation',
  'utilisateur.reactivation',
  'droits.modification',
  'journal.export',
] as const
export type ActionAudit = (typeof ACTIONS_AUDIT)[number]

export const RESULTATS_AUDIT = ['succes', 'echec', 'refuse'] as const
export type ResultatAudit = (typeof RESULTATS_AUDIT)[number]

export const TYPES_CIBLE_AUDIT = [
  'source', 'jeu', 'utilisateur', 'artefact', 'conversation', 'partage', 'droits', 'journal',
] as const
export type TypeCibleAudit = (typeof TYPES_CIBLE_AUDIT)[number]

export const familleDe = (action: string): string => action.split('.')[0] ?? action
/** Clé de traduction d'une action : `source.creation` -> `source_creation`. */
export const cleTraductionAction = (action: string): string => action.replaceAll('.', '_')

export interface CibleAudit {
  type: TypeCibleAudit
  id?: string | null
  /** Libellé court (titre de la source, rôle, nom de fichier…), jamais un contenu de données. */
  libelle?: string | null
}

export interface EntreeAudit {
  /** Identifiant de l'acteur ; absent pour une connexion échouée sur un compte inconnu. */
  acteurId?: string | null
  action: ActionAudit
  cible?: CibleAudit
  /** Défaut : `succes`. */
  resultat?: ResultatAudit
  /** Détails libres, assainis et bornés avant écriture (voir lib/audit/details.ts). */
  details?: Record<string, unknown>
  /** IP déjà déterminée ; sinon déduite des en-têtes de la requête courante via le proxy de confiance. */
  ip?: string | null
}

export interface LigneAudit {
  id: string
  faitA: Date
  acteurId: string | null
  /** Nom (ou e-mail à défaut) lu en base pour l'affichage ; jamais stocké dans le journal. */
  acteurNom: string | null
  action: string
  cibleType: string | null
  cibleId: string | null
  cibleLibelle: string | null
  resultat: ResultatAudit
  details: Record<string, unknown>
  ip: string | null
}

export interface FiltresAudit {
  depuis?: Date
  jusqua?: Date
  /** Texte libre : identifiant exact, ou fragment du nom / de l'e-mail du compte. */
  acteur?: string
  famille?: FamilleAudit
  action?: ActionAudit
  /** Texte libre : identifiant exact de la cible ou fragment de son libellé. */
  cible?: string
}

/** Conservation du journal, en jours. */
export const CONSERVATION_JOURS = 365
export const TAILLE_PAGE_AUDIT = 50
export const EXPORT_MAX_LIGNES = 5000
