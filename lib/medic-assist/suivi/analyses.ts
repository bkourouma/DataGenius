/**
 * Mes analyses : artefacts que l'utilisateur a enregistres. Seul le proprietaire
 * d'un artefact peut l'enregistrer (un artefact recu par partage s'epingle ou se
 * consulte, il ne s'enregistre pas). Retirer une analyse ne supprime jamais l'artefact.
 */

import type { ContexteExecution } from '@/lib/medic-assist/contrats'

import type { DepotSuivi } from './depot'
import { obtenirDepot } from './depot-prisma'
import { ErreurSuivi } from './erreurs'
import type { AnalyseResume } from './types'

export interface DependancesAnalyses {
  depot?: DepotSuivi
}

export interface AnalyseResumeJson {
  artefactId: string
  titre: string
  type: string
  sousTitre: string | null
  conversationId: string
  /** ISO. */
  enregistreeLe: string
  /** Toujours faux : seuls les artefacts du proprietaire sont enregistrables. */
  partage: boolean
}

export function analyseEnJson(ligne: AnalyseResume): AnalyseResumeJson {
  return {
    artefactId: ligne.artefactId,
    titre: ligne.titre,
    type: ligne.type,
    sousTitre: ligne.sousTitre,
    conversationId: ligne.conversationId,
    enregistreeLe: ligne.enregistreeA.toISOString(),
    partage: ligne.partage,
  }
}

export async function listerAnalyses(
  contexte: ContexteExecution,
  options: { recherche?: string; artefactId?: string; page: number; taille: number },
  deps: DependancesAnalyses = {}
): Promise<{ lignes: AnalyseResumeJson[]; total: number }> {
  const depot = deps.depot ?? obtenirDepot()
  const recherche = options.recherche?.trim()
  const { lignes, total } = await depot.listerAnalyses(contexte.userId, {
    ...(recherche ? { recherche } : {}),
    ...(options.artefactId ? { artefactId: options.artefactId } : {}),
    page: options.page,
    taille: options.taille,
  })
  return { lignes: lignes.map(analyseEnJson), total }
}

/** L'artefact doit appartenir a l'utilisateur ; idempotent. */
export async function enregistrerAnalyse(
  contexte: ContexteExecution,
  artefactId: string,
  deps: DependancesAnalyses = {}
): Promise<{ cree: boolean }> {
  const depot = deps.depot ?? obtenirDepot()
  const artefact = await depot.trouverArtefactProprietaire(artefactId, contexte.userId)
  if (!artefact) throw new ErreurSuivi('introuvable')
  return { cree: await depot.enregistrerAnalyse(contexte.userId, artefactId) }
}

/** Retire de Mes analyses ; introuvable si cet utilisateur ne l'avait pas enregistre. */
export async function retirerAnalyse(
  contexte: ContexteExecution,
  artefactId: string,
  deps: DependancesAnalyses = {}
): Promise<void> {
  const depot = deps.depot ?? obtenirDepot()
  const retire = await depot.retirerAnalyse(contexte.userId, artefactId)
  if (!retire) throw new ErreurSuivi('introuvable')
}
