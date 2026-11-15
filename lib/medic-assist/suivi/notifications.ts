/**
 * Creation des notifications in_app de Medic Assist (lues par la cloche de
 * l'en-tete, components/dashboard/cloche-notifications.tsx).
 *
 * Le titre et le message sont ecrits DANS LA LANGUE DU DESTINATAIRE par
 * l'appelant (comme l'annonce de la revue du mois) : la cloche les affiche tels
 * quels.
 */

import { prisma } from '@/lib/db/client'

import { TYPES_NOTIFICATION } from '@/lib/medic-assist/contrats'

export type TypeNotificationSuivi = (typeof TYPES_NOTIFICATION)[keyof typeof TYPES_NOTIFICATION]

/**
 * `relatedEntityType` + `relatedEntityId` pilotent le lien de la cloche :
 * - 'conversation' + id : /assistant?c=<id>
 * - 'artefact' + id     : /assistant/analyses?onglet=partages
 * - 'tache' + id        : /assistant/analyses?onglet=taches
 */
export type EntiteNotificationSuivi = 'conversation' | 'artefact' | 'tache'

export interface NouvelleNotificationSuivi {
  userId: string
  type: TypeNotificationSuivi
  titre: string
  message: string
  entite?: { type: EntiteNotificationSuivi; id: string }
}

export async function creerNotificationSuivi(n: NouvelleNotificationSuivi): Promise<string> {
  const creee = await prisma.notification.create({
    data: {
      userId: n.userId,
      type: n.type,
      title: n.titre,
      message: n.message,
      relatedEntityType: n.entite?.type ?? null,
      relatedEntityId: n.entite?.id ?? null,
      channel: 'in_app',
      status: 'sent',
      sentAt: new Date(),
    },
    select: { id: true },
  })
  return creee.id
}
