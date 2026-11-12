import { auteurDansPerimetreLecteur, contenuAuPerimetreCourant, restrictionsActives } from '@/lib/auth/data-access'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'

/** Vérification complémentaire aux droits de propriété et de partage. */
export async function ressourceDansPerimetre(contexte: ContexteExecution, type: 'artefact' | 'conversation', id: string) {
  const droits = contexte.scope.donnees
  if (!restrictionsActives(droits) || droits.administrateur) return true
  const cible = type === 'conversation'
    ? await prisma.assistantConversation.findUnique({ where: { id }, select: { userId: true, createdAt: true } })
    : await prisma.assistantArtefact.findFirst({ where: { OR: [{ id }, { racineId: id }] },
        orderBy: { version: 'asc' }, select: { userId: true, createdAt: true } })
  return !!cible && contenuAuPerimetreCourant(droits, cible.createdAt) &&
    auteurDansPerimetreLecteur(droits, contexte.userId, cible.userId)
}
