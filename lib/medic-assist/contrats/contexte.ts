/**
 * Contexte d'execution transmis a toute fonction serveur de Medic Assist qui
 * lit des donnees. Le perimetre (`scope`) vient de la session, jamais du
 * modele : l'IA ne peut ni l'elargir ni le choisir.
 *
 * Construit par exigerMedicAssist() (lib/medic-assist/acces.ts) ; pour un rapport
 * programme ou un partage, il est reconstruit avec le perimetre du DESTINATAIRE.
 */

import type { Locale } from '@/i18n/config'
import type { AccessScope } from '@/lib/auth/access-scope'

export interface ContexteExecution {
  /** Utilisateur de la session (propriétaire des conversations, artefacts, jeux). */
  userId: string
  /** Rôle de la session Data Genius. */
  roleName: string
  /** Périmètre Data Genius issu de la session. */
  scope: AccessScope
  /** Habilitations du profil ; null = compte sans profil, rien n'est restreint. */
  habilitations: string[] | null
  /** Langue de l'interface (cookie), a defaut la langue par defaut. */
  locale: Locale
  /** Conversation en cours, quand il y en a une. */
  conversationId?: string
  /** Horloge de la requete : toute date relative se calcule depuis elle. */
  maintenant: Date
  /** Jour limite de saisie des sorties locales (lireJourLimite), pour le « dernier mois clos ». */
  jourLimite: number
}
