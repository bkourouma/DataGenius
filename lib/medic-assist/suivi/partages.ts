/**
 * Partage d'une conversation ou d'un artefact. SEUL le proprietaire partage
 * (on ne repartage pas ce qu'on a recu). Les destinataires doivent avoir acces a
 * Medic Assist (hypothese H7). Lecture seule : le destinataire voit les chiffres
 * recalcules dans son propre perimetre.
 */

import { prisma } from '@/lib/db/client'
import { destinataireCouvrePerimetre } from '@/lib/auth/data-access'
import { ressourceDansPerimetre } from './perimetre-ressource'

import { LIMITES, TYPES_NOTIFICATION, type ContexteExecution } from '@/lib/medic-assist/contrats'
import { chargerComptesAvecAcces, validerDestinataires } from './comptes'
import type { DepotSuivi } from './depot'
import { obtenirDepot } from './depot-prisma'
import { traducteurSuivi } from './emails'
import { ErreurSuivi } from './erreurs'
import { creerNotificationSuivi } from './notifications'
import type { CompteJson, PartageEnvoye, PartageRecu, TypeCiblePartage } from './types'

export interface DependancesPartages {
  depot?: DepotSuivi
}

export interface PartageRecuJson {
  id: string
  cibleType: TypeCiblePartage
  cibleId: string
  titre: string
  conversationId: string | null
  expediteurNom: string
  message: string | null
  /** ISO. */
  creeLe: string
}

export interface PartageEnvoyeJson {
  id: string
  cibleType: TypeCiblePartage
  cibleId: string
  titre: string
  destinataireNom: string
  /** ISO. */
  creeLe: string
}

export interface DemandePartage {
  cible: { type: TypeCiblePartage; id: string }
  destinataires: string[]
  message?: string
}

function recuEnJson(p: PartageRecu): PartageRecuJson {
  return {
    id: p.id,
    cibleType: p.cibleType,
    cibleId: p.cibleId,
    titre: p.titre,
    conversationId: p.conversationId,
    expediteurNom: p.expediteurNom,
    message: p.message,
    creeLe: p.creeA.toISOString(),
  }
}

function envoyeEnJson(p: PartageEnvoye): PartageEnvoyeJson {
  return {
    id: p.id,
    cibleType: p.cibleType,
    cibleId: p.cibleId,
    titre: p.titre,
    destinataireNom: p.destinataireNom,
    creeLe: p.creeA.toISOString(),
  }
}

async function nomUtilisateur(userId: string): Promise<string> {
  const compte = await prisma.user.findFirst({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  })
  return compte ? `${compte.firstName} ${compte.lastName}`.trim() : ''
}

export async function partager(
  contexte: ContexteExecution,
  demande: DemandePartage,
  deps: DependancesPartages = {}
): Promise<{ partages: number }> {
  const depot = deps.depot ?? obtenirDepot()
  const { cible } = demande

  // Seul le proprietaire partage : le proprietaire est dans le meme where.
  const titre =
    cible.type === 'conversation'
      ? (await depot.trouverConversationProprietaire(cible.id, contexte.userId))?.titre
      : (await depot.trouverArtefactProprietaire(cible.id, contexte.userId))?.titre
  if (titre === undefined || !(await ressourceDansPerimetre(contexte, cible.type, cible.id))) throw new ErreurSuivi('introuvable')

  const ids = [...new Set(demande.destinataires)]
  if (ids.length < 1 || ids.length > LIMITES.destinatairesMax) {
    throw new ErreurSuivi('destinataire_invalide')
  }
  const { comptes, refuses } = await validerDestinataires(ids, { exclureId: contexte.userId })
  if (refuses.length > 0 || comptes.length === 0) throw new ErreurSuivi('destinataire_invalide')
  const autorisations = await Promise.all(comptes.map(c => destinataireCouvrePerimetre(contexte.scope.donnees, c.id)))
  if (autorisations.some(ok => !ok)) throw new ErreurSuivi('destinataire_invalide')

  const message = demande.message?.trim() || null
  const crees = await depot.creerPartages(
    comptes.map((c) => ({
      expediteurId: contexte.userId,
      destinataireId: c.id,
      cibleType: cible.type,
      cibleId: cible.id,
      message,
    }))
  )

  // Notification seulement pour les destinataires reellement nouveaux.
  if (crees.length > 0) {
    const parId = new Map(comptes.map((c) => [c.id, c]))
    const expediteur = await nomUtilisateur(contexte.userId)
    for (const partage of crees) {
      const destinataire = parId.get(partage.destinataireId)
      if (!destinataire) continue
      const t = await traducteurSuivi(destinataire.locale)
      await creerNotificationSuivi({
        userId: destinataire.id,
        type: TYPES_NOTIFICATION.partage,
        titre: t(
          cible.type === 'conversation'
            ? 'notifPartage.titreConversation'
            : 'notifPartage.titreArtefact',
          { expediteur }
        ),
        message: t('notifPartage.message', { titre }),
        entite: { type: cible.type, id: cible.id },
      })
    }
  }
  return { partages: crees.length }
}

export async function listerPartagesRecus(
  contexte: ContexteExecution,
  pagination: { page: number; taille: number },
  deps: DependancesPartages = {}
): Promise<{ lignes: PartageRecuJson[]; total: number }> {
  const depot = deps.depot ?? obtenirDepot()
  const { lignes, total } = await depot.listerPartagesRecus(contexte.userId, pagination)
  const autorisations = await Promise.all(lignes.map(l => ressourceDansPerimetre(contexte, l.cibleType, l.cibleId)))
  return { lignes: lignes.filter((_, i) => autorisations[i]).map(recuEnJson), total }
}

export async function listerPartagesEnvoyes(
  contexte: ContexteExecution,
  pagination: { page: number; taille: number },
  deps: DependancesPartages = {}
): Promise<{ lignes: PartageEnvoyeJson[]; total: number }> {
  const depot = deps.depot ?? obtenirDepot()
  const { lignes, total } = await depot.listerPartagesEnvoyes(contexte.userId, pagination)
  const autorisations = await Promise.all(lignes.map(l => ressourceDansPerimetre(contexte, l.cibleType, l.cibleId)))
  return { lignes: lignes.filter((_, i) => autorisations[i]).map(envoyeEnJson), total }
}

/**
 * Retire un partage (expediteur : « retirer le partage » ; destinataire : « ne plus
 * voir »). Les epingles du destinataire que ce partage justifiait disparaissent avec
 * lui (le depot le fait dans la meme transaction). Un tiers recoit 404. Aucune notification.
 */
export async function retirerPartage(
  contexte: ContexteExecution,
  partageId: string,
  deps: DependancesPartages = {}
): Promise<void> {
  const depot = deps.depot ?? obtenirDepot()
  const retire = await depot.retirerPartage(partageId, contexte.userId)
  if (!retire) throw new ErreurSuivi('introuvable')
}

/**
 * Selecteur d'utilisateurs et resolution des noms deja choisis. Sans `ids`,
 * l'utilisateur courant est exclu ; avec `ids`, la resolution est explicite.
 */
export async function rechercherComptes(
  contexte: ContexteExecution,
  options: { recherche?: string; ids?: string[] } = {}
): Promise<CompteJson[]> {
  const ids = options.ids?.length
    ? [...new Set(options.ids)].slice(0, LIMITES.destinatairesMax)
    : undefined
  const recherche = options.recherche?.trim()
  const comptes = await chargerComptesAvecAcces({
    ...(ids ? { ids } : { exclureId: contexte.userId }),
    ...(recherche ? { recherche } : {}),
    limite: LIMITES.destinatairesMax,
  })
  return comptes.map((c) => ({ id: c.id, nom: c.nom, email: c.email }))
}

/**
 * Droits de l'utilisateur sur un artefact visible : `proprietaire` = il peut le
 * partager, l'envoyer, le notifier ou le programmer ; sinon il peut seulement le
 * voir et l'epingler. Introuvable (404) si l'artefact ne lui est pas visible.
 */
export async function droitsSurArtefact(
  contexte: ContexteExecution,
  artefactId: string,
  deps: DependancesPartages = {}
): Promise<{ proprietaire: boolean }> {
  const depot = deps.depot ?? obtenirDepot()
  const artefact = await depot.trouverArtefactVisible(artefactId, contexte.userId)
  if (!artefact) throw new ErreurSuivi('introuvable')
  return { proprietaire: artefact.proprietaireId === contexte.userId }
}
