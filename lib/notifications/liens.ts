/**
 * Lien d'une notification selon son type d'entité (pur : aucun import Prisma ni Node).
 * Le lien est toujours relatif ; l'identifiant stocké est validé et encodé pour qu'aucune
 * valeur en base ne puisse fabriquer un lien externe.
 */

const IDENTIFIANT_VALIDE = /^[A-Za-z0-9_-]{1,100}$/

export function lienNotification(
  _type: string,
  relatedEntityType: string | null | undefined,
  relatedEntityId: string | null | undefined
): string | null {
  if (!relatedEntityType) return null
  if (relatedEntityType === 'artefact') return '/assistant/analyses?onglet=partages'
  if (relatedEntityType === 'tache') return '/assistant/analyses?onglet=taches'
  if (typeof relatedEntityId !== 'string' || !IDENTIFIANT_VALIDE.test(relatedEntityId)) return null
  const id = encodeURIComponent(relatedEntityId)
  if (relatedEntityType === 'tableau') return `/tableaux/${id}`
  if (relatedEntityType === 'conversation') return `/assistant?c=${id}`
  return null
}
