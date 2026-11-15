/**
 * Commentaires en texte brut sur une analyse (AssistantArtefact). `artefactId` est le
 * racineId. Visibilité : exactement celle de l'analyse (propriété ou partage, puis droits par
 * jeu). Qui ne voit pas l'analyse reçoit « introuvable » : l'existence n'est jamais révélée.
 */
import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { obtenirDepot } from '@/lib/medic-assist/suivi/depot-prisma'
import { ressourceDansPerimetre } from '@/lib/medic-assist/suivi/perimetre-ressource'
import { ErreurCommentaire, LONGUEUR_MAX_COMMENTAIRE, longueurTexte, normaliserTexte } from './texte'

export { ErreurCommentaire, LONGUEUR_MAX_COMMENTAIRE, longueurTexte, normaliserTexte }
export type { CodeErreurCommentaire } from './texte'

export const LIMITE_COMMENTAIRES = 10
export const FENETRE_LIMITE_MINUTES = 10
export const NOMBRE_MAX_LISTE = 100

export interface CommentaireAnalyse {
  id: string
  texte: string
  auteurNom: string
  auteurId: string
  creeLe: string
  supprimable: boolean
}

export interface DependancesCommentaires {
  /** Contrôle de visibilité de l'analyse ; par défaut la règle des analyses partagées. */
  analyseVisible?: (contexte: ContexteExecution, artefactId: string) => Promise<boolean>
}

/** Règle existante : propriétaire ou destinataire d'un partage, puis droits par jeu. */
export async function analyseVisible(contexte: ContexteExecution, artefactId: string): Promise<boolean> {
  if (!artefactId) return false
  const artefact = await obtenirDepot().trouverArtefactVisible(artefactId, contexte.userId)
  if (!artefact) return false
  return ressourceDansPerimetre(contexte, 'artefact', artefactId)
}

/** Auteur du commentaire ou TenantAdmin. */
export function peutSupprimer(contexte: Pick<ContexteExecution, 'userId' | 'roleName'>, auteurId: string): boolean {
  return contexte.userId === auteurId || contexte.roleName === 'TenantAdmin'
}

async function exigerVisible(contexte: ContexteExecution, artefactId: string, deps: DependancesCommentaires) {
  const visible = deps.analyseVisible ?? analyseVisible
  if (!(await visible(contexte, artefactId))) throw new ErreurCommentaire('introuvable')
}

interface LigneListe {
  id: string
  texte: string
  auteur_id: string
  prenom: string
  nom: string
  cree_a: Date
}

export async function listerCommentaires(
  contexte: ContexteExecution,
  artefactId: string,
  deps: DependancesCommentaires = {},
): Promise<CommentaireAnalyse[]> {
  await exigerVisible(contexte, artefactId, deps)
  const lignes = await prisma.$queryRaw<LigneListe[]>`
    SELECT r.id, r.texte, r.auteur_id, r.cree_a, u."firstName" AS prenom, u."lastName" AS nom
    FROM (
      SELECT id, texte, auteur_id, cree_a
      FROM warehouse.commentaires_analyses
      WHERE artefact_id = ${artefactId}
      ORDER BY cree_a DESC, id DESC
      LIMIT ${NOMBRE_MAX_LISTE}
    ) r
    JOIN "users" u ON u.id = r.auteur_id
    ORDER BY r.cree_a ASC, r.id ASC`
  return lignes.map((ligne) => ({
    id: ligne.id,
    texte: ligne.texte,
    auteurNom: `${ligne.prenom} ${ligne.nom}`.trim(),
    auteurId: ligne.auteur_id,
    creeLe: new Date(ligne.cree_a).toISOString(),
    supprimable: peutSupprimer(contexte, ligne.auteur_id),
  }))
}

export async function ajouterCommentaire(
  contexte: ContexteExecution,
  artefactId: string,
  texte: string,
  deps: DependancesCommentaires = {},
): Promise<{ id: string }> {
  await exigerVisible(contexte, artefactId, deps)
  const propre = normaliserTexte(texte)
  const id = randomUUID()
  // Insertion conditionnelle : la limite de débit est comptée dans la même instruction.
  const inseres = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO warehouse.commentaires_analyses (id, artefact_id, auteur_id, texte)
    SELECT ${id}, ${artefactId}, ${contexte.userId}, ${propre}
    WHERE (
      SELECT count(*) FROM warehouse.commentaires_analyses
      WHERE auteur_id = ${contexte.userId}
        AND cree_a > clock_timestamp() - make_interval(mins => ${FENETRE_LIMITE_MINUTES}::int)
    ) < ${LIMITE_COMMENTAIRES}::int
    RETURNING id`
  if (inseres.length === 0) throw new ErreurCommentaire('limite_debit')
  journal.info('Commentaire ajouté', { artefactId, commentaireId: id })
  return { id }
}

export async function supprimerCommentaire(
  contexte: ContexteExecution,
  commentaireId: string,
  deps: DependancesCommentaires = {},
): Promise<{ artefactId: string }> {
  const lignes = await prisma.$queryRaw<{ artefact_id: string; auteur_id: string }[]>`
    SELECT artefact_id, auteur_id FROM warehouse.commentaires_analyses WHERE id = ${commentaireId}`
  const commentaire = lignes[0]
  if (!commentaire) throw new ErreurCommentaire('introuvable')
  if (!peutSupprimer(contexte, commentaire.auteur_id)) {
    const visible = deps.analyseVisible ?? analyseVisible
    throw new ErreurCommentaire((await visible(contexte, commentaire.artefact_id)) ? 'interdit' : 'introuvable')
  }
  await prisma.$executeRaw`DELETE FROM warehouse.commentaires_analyses WHERE id = ${commentaireId}`
  journal.info('Commentaire supprimé', { artefactId: commentaire.artefact_id, commentaireId })
  return { artefactId: commentaire.artefact_id }
}
