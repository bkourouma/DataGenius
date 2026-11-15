/**
 * Lecture et écriture des notifications in_app de la cloche.
 * Toutes les fonctions prennent l'identifiant de la session et filtrent TOUJOURS sur userId.
 */

import { prisma } from '@/lib/db/client'
import { lienNotification } from './liens'

export interface NotificationCloche {
  id: string
  type: string
  titre: string
  message: string
  lue: boolean
  creeLe: string
  lien: string | null
}

export const LIMITE_DEFAUT = 10
export const LIMITE_MAX = 20

export async function listerNotifications(userId: string, limite: number = LIMITE_DEFAUT) {
  const borne = Math.min(Math.max(Math.trunc(limite) || LIMITE_DEFAUT, 1), LIMITE_MAX)
  const [nonLues, lignes] = await Promise.all([
    prisma.notification.count({ where: { userId, channel: 'in_app', readAt: null } }),
    prisma.notification.findMany({
      where: { userId, channel: 'in_app' },
      orderBy: { createdAt: 'desc' },
      take: borne,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        relatedEntityType: true,
        relatedEntityId: true,
        readAt: true,
        createdAt: true,
      },
    }),
  ])
  const notifications: NotificationCloche[] = lignes.map(ligne => ({
    id: ligne.id,
    type: ligne.type,
    titre: ligne.title,
    message: ligne.message,
    lue: ligne.readAt !== null,
    creeLe: ligne.createdAt.toISOString(),
    lien: lienNotification(ligne.type, ligne.relatedEntityType, ligne.relatedEntityId),
  }))
  return { nonLues, notifications }
}

async function compterNonLues(userId: string) {
  return prisma.notification.count({ where: { userId, channel: 'in_app', readAt: null } })
}

/** Retourne null si la notification n'existe pas ou n'appartient pas à l'utilisateur. */
export async function marquerLue(userId: string, id: string): Promise<{ nonLues: number } | null> {
  const existante = await prisma.notification.findFirst({
    where: { id, userId, channel: 'in_app' },
    select: { id: true },
  })
  if (!existante) return null
  await prisma.notification.updateMany({
    where: { id, userId, channel: 'in_app', readAt: null },
    data: { readAt: new Date() },
  })
  return { nonLues: await compterNonLues(userId) }
}

export async function marquerToutesLues(userId: string): Promise<{ nonLues: number }> {
  await prisma.notification.updateMany({
    where: { userId, channel: 'in_app', readAt: null },
    data: { readAt: new Date() },
  })
  return { nonLues: await compterNonLues(userId) }
}
