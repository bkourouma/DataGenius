/**
 * Epingles du tableau de bord. Contrairement a Mes analyses, un destinataire de
 * partage peut epingler : l'artefact doit seulement lui etre visible, et une epingle
 * dont l'artefact n'est plus visible n'est pas listee.
 */

import type { ContexteExecution } from '@/lib/medic-assist/contrats'

import type { DepotSuivi } from './depot'
import { obtenirDepot } from './depot-prisma'
import { ErreurSuivi } from './erreurs'
import { ressourceDansPerimetre } from './perimetre-ressource'
import type { EpingleResume } from './types'

export interface DependancesEpingles {
  depot?: DepotSuivi
}

export interface EpingleJson {
  artefactId: string
  titre: string
  type: string
  conversationId: string
  ordre: number
  /** ISO. */
  epingleeLe: string
}

export function epingleEnJson(ligne: EpingleResume): EpingleJson {
  return {
    artefactId: ligne.artefactId,
    titre: ligne.titre,
    type: ligne.type,
    conversationId: ligne.conversationId,
    ordre: ligne.ordre,
    epingleeLe: ligne.epingleeA.toISOString(),
  }
}

export async function listerEpingles(
  contexte: ContexteExecution,
  options: { artefactId?: string } = {},
  deps: DependancesEpingles = {}
): Promise<EpingleJson[]> {
  const depot = deps.depot ?? obtenirDepot()
  const lignes = await depot.listerEpingles(
    contexte.userId,
    options.artefactId ? { artefactId: options.artefactId } : undefined
  )
  const autorisations = await Promise.all(lignes.map(l => ressourceDansPerimetre(contexte, 'artefact', l.artefactId)))
  return lignes.filter((_, i) => autorisations[i]).map(epingleEnJson)
}

/** L'artefact doit etre visible (proprietaire ou partage) ; idempotent. */
export async function epinglerArtefact(
  contexte: ContexteExecution,
  artefactId: string,
  deps: DependancesEpingles = {}
): Promise<{ cree: boolean }> {
  const depot = deps.depot ?? obtenirDepot()
  const artefact = await depot.trouverArtefactVisible(artefactId, contexte.userId)
  if (!artefact || !(await ressourceDansPerimetre(contexte, 'artefact', artefactId))) throw new ErreurSuivi('introuvable')
  return { cree: await depot.epingler(contexte.userId, artefactId) }
}

export async function desepinglerArtefact(
  contexte: ContexteExecution,
  artefactId: string,
  deps: DependancesEpingles = {}
): Promise<void> {
  const depot = deps.depot ?? obtenirDepot()
  const retire = await depot.desepingler(contexte.userId, artefactId)
  if (!retire) throw new ErreurSuivi('introuvable')
}
