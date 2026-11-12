/**
 * Mes taches : table Task existante, qui n'a ni colonne « cree par » ni relation
 * User. « Mes taches » = celles qui me sont assignees + celles que j'ai creees
 * via l'assistant (retrouvees par les actions executees, voir le depot).
 */

import { prisma } from '@/lib/db/client'

import {
  PRIORITE_TACHE_EN_BASE,
  STATUT_TACHE_EN_BASE,
  type ContexteExecution,
  type PrioriteTache,
} from '@/lib/medic-assist/contrats'

import type { DepotSuivi } from './depot'
import { obtenirDepot } from './depot-prisma'
import { ErreurSuivi } from './erreurs'
import type { TacheJson } from './types'

export interface DependancesTaches {
  depot?: DepotSuivi
}

export type EtatTache = TacheJson['etat']

interface LigneTache {
  id: string
  title: string
  description: string | null
  assignedToId: string
  dueDate: Date | null
  priority: string
  relatedEntityType: string | null
  relatedEntityId: string | null
  status: string
  completedAt: Date | null
  createdAt: Date
}

/** Task.priority (anglais) -> priorite du contrat, d'apres PRIORITE_TACHE_EN_BASE. */
const PRIORITES: Record<string, PrioriteTache> = Object.fromEntries(
  Object.entries(PRIORITE_TACHE_EN_BASE).map(([priorite, enBase]) => [enBase, priorite as PrioriteTache])
)

function etatDeLaTache(tache: LigneTache, maintenant: Date): EtatTache {
  if (tache.status === STATUT_TACHE_EN_BASE.terminee) return 'terminee'
  if (tache.dueDate && tache.dueDate.getTime() < maintenant.getTime()) return 'en_retard'
  return 'a_faire'
}

function enJson(
  tache: LigneTache,
  contexte: ContexteExecution,
  noms: Map<string, string>,
  createurs: Map<string, string>
): TacheJson {
  const etat = etatDeLaTache(tache, contexte.maintenant)
  const createur = createurs.get(tache.id)
  // Une tache de l'assistant pointe sur sa conversation (lien de type 'conversation').
  const conversationId =
    tache.relatedEntityType === 'conversation' ? (tache.relatedEntityId ?? null) : null
  return {
    id: tache.id,
    titre: tache.title,
    description: tache.description,
    priorite: PRIORITES[tache.priority] ?? 'normale',
    echeance: tache.dueDate ? tache.dueDate.toISOString() : null,
    etat,
    terminee: etat === 'terminee',
    termineeLe: tache.completedAt ? tache.completedAt.toISOString() : null,
    assigneeNom: noms.get(tache.assignedToId) ?? '',
    creeParNom: createur ? (noms.get(createur) ?? null) : null,
    assigneeAMoi: tache.assignedToId === contexte.userId,
    conversationId,
    // La conversation est celle du createur de la tache : seul lui peut l'ouvrir.
    conversationOuvrable: conversationId !== null && createur === contexte.userId,
    creeLe: tache.createdAt.toISOString(),
  }
}

/** En retard d'abord, puis echeance croissante (sans echeance en dernier), puis terminees recentes d'abord. */
function comparer(a: TacheJson, b: TacheJson): number {
  const rang = (t: TacheJson) => (t.etat === 'en_retard' ? 0 : t.etat === 'a_faire' ? 1 : 2)
  if (rang(a) !== rang(b)) return rang(a) - rang(b)
  if (a.etat === 'terminee') return (b.termineeLe ?? '').localeCompare(a.termineeLe ?? '')
  if (a.echeance && b.echeance) return a.echeance.localeCompare(b.echeance)
  if (a.echeance) return -1
  if (b.echeance) return 1
  return a.creeLe.localeCompare(b.creeLe)
}

/** Une seule requete pour tous les noms (assignes et createurs). */
async function nomsDes(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const utilisateurs = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true },
  })
  return new Map(utilisateurs.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]))
}

export async function listerTaches(
  contexte: ContexteExecution,
  options: { etat?: EtatTache } = {},
  deps: DependancesTaches = {}
): Promise<TacheJson[]> {
  const depot = deps.depot ?? obtenirDepot()
  const creees = await depot.idsTachesCreeesPar(contexte.userId)
  const taches = (await prisma.task.findMany({
    where: {
      OR: [{ assignedToId: contexte.userId }, ...(creees.length ? [{ id: { in: creees } }] : [])],
    },
  })) as LigneTache[]
  if (taches.length === 0) return []

  const createurs = await depot.createursDesTaches(taches.map((t) => t.id))
  const noms = await nomsDes([
    ...new Set([...taches.map((t) => t.assignedToId), ...createurs.values()]),
  ])
  return taches
    .map((t) => enJson(t, contexte, noms, createurs))
    .filter((t) => !options.etat || t.etat === options.etat)
    .sort(comparer)
}

/** SEUL l'assigne marque terminee ou rouvre ; idempotent. */
export async function changerEtatTache(
  contexte: ContexteExecution,
  donnees: { id: string; terminee: boolean },
  deps: DependancesTaches = {}
): Promise<TacheJson> {
  const depot = deps.depot ?? obtenirDepot()
  const { count } = await prisma.task.updateMany({
    where: { id: donnees.id, assignedToId: contexte.userId },
    data: donnees.terminee
      ? { status: STATUT_TACHE_EN_BASE.terminee, completedAt: contexte.maintenant }
      : { status: STATUT_TACHE_EN_BASE.a_faire, completedAt: null },
  })
  if (count === 0) throw new ErreurSuivi('introuvable')

  const tache = (await prisma.task.findFirst({
    where: { id: donnees.id, assignedToId: contexte.userId },
  })) as LigneTache | null
  if (!tache) throw new ErreurSuivi('introuvable')
  const createurs = await depot.createursDesTaches([tache.id])
  const noms = await nomsDes([...new Set([tache.assignedToId, ...createurs.values()])])
  return enJson(tache, contexte, noms, createurs)
}
