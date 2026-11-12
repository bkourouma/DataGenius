/**
 * Persistance du chat de Medic Assist (lot 1) : conversation, pièces jointes, historique,
 * messages, usages et rattachement des actions proposées.
 *
 * Isolation (architecture §3) : chaque lecture ou écriture par id porte la condition de
 * propriétaire dans le MÊME `where` (`userId` direct, ou `conversation: { userId }` pour les
 * messages). Le `userId` vient toujours du contexte serveur (`exigerMedicAssist()`).
 *
 * Aucune fonction ne journalise le contenu d'un message : seulement des noms d'erreur.
 */

import { prisma } from '@/lib/db/client'
import type {
  ContexteEcran,
  MessageMedicAssist,
  MetadonneesMessage,
  Mode,
  UsageTokens,
} from '@/lib/medic-assist/contrats'

import { TITRE_PAR_DEFAUT_CONVERSATION, creerConversation } from './conversations'

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export interface ConversationChat {
  id: string
  titre: string
}

/** Conversation du PROPRIÉTAIRE seulement (un lecteur par partage n'écrit pas) ; null sinon. */
export async function lireConversationProprietaire(
  userId: string,
  conversationId: string,
  dateMin?: Date,
): Promise<ConversationChat | null> {
  return prisma.assistantConversation.findFirst({
    where: { id: conversationId, userId, ...(dateMin && { createdAt: { gte: dateMin } }) },
    select: { id: true, titre: true },
  })
}

/** Crée la conversation côté serveur, au titre par défaut. */
export async function creerConversationChat(userId: string): Promise<ConversationChat> {
  const cree = await creerConversation({ userId }, {})
  return { id: cree.id, titre: TITRE_PAR_DEFAUT_CONVERSATION }
}

/**
 * Titre généré après le premier échange. Le `where` garde le propriétaire ET le titre par
 * défaut : un titre choisi entre-temps par l'utilisateur n'est jamais écrasé.
 */
export async function enregistrerTitre(
  userId: string,
  conversationId: string,
  titre: string
): Promise<boolean> {
  const resultat = await prisma.assistantConversation.updateMany({
    where: { id: conversationId, userId, titre: TITRE_PAR_DEFAUT_CONVERSATION },
    data: { titre },
  })
  return resultat.count > 0
}

async function toucherConversation(userId: string, conversationId: string): Promise<void> {
  await prisma.assistantConversation.updateMany({
    where: { id: conversationId, userId },
    data: { dernierMessageA: new Date() },
  })
}

// ---------------------------------------------------------------------------
// Pièces jointes
// ---------------------------------------------------------------------------

export interface PieceJointeChat {
  id: string
  nom: string
}

/**
 * Pièces jointes de l'utilisateur, dans l'ordre demandé. `null` si l'une d'elles est inconnue
 * ou appartient à un autre utilisateur (indiscernables).
 */
export async function lirePiecesJointesProprietaire(
  userId: string,
  ids: readonly string[]
): Promise<PieceJointeChat[] | null> {
  const uniques = [...new Set(ids)]
  if (uniques.length === 0) return []
  const lignes = await prisma.assistantPieceJointe.findMany({
    where: { id: { in: uniques }, userId },
    select: { id: true, nomFichier: true },
  })
  if (lignes.length !== uniques.length) return null
  const parId = new Map(lignes.map(l => [l.id, l.nomFichier]))
  return uniques.map(id => ({ id, nom: parId.get(id) ?? '' }))
}

/** Rattache les pièces jointes (de l'utilisateur) à la conversation. */
export async function rattacherPiecesJointes(
  userId: string,
  ids: readonly string[],
  conversationId: string
): Promise<void> {
  if (ids.length === 0) return
  await prisma.assistantPieceJointe.updateMany({
    where: { id: { in: [...ids] }, userId },
    data: { conversationId },
  })
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

/**
 * Messages user/assistant de la conversation, du plus ancien au plus récent, relus EN BASE
 * (jamais depuis le client). Le propriétaire est dans le même `where`.
 */
export async function lireHistorique(
  userId: string,
  conversationId: string
): Promise<MessageMedicAssist[]> {
  const lignes = await prisma.assistantMessage.findMany({
    where: { conversationId, conversation: { userId }, role: { in: ['user', 'assistant'] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, role: true, parts: true, metadonnees: true },
  })
  return lignes.map(l => ({
    id: l.id,
    role: l.role as 'user' | 'assistant',
    parts: (Array.isArray(l.parts) ? l.parts : []) as MessageMedicAssist['parts'],
    ...(l.metadonnees && typeof l.metadonnees === 'object'
      ? { metadata: l.metadonnees as MetadonneesMessage }
      : {}),
  }))
}

/** Supprime un message ASSISTANT de la conversation du propriétaire (régénération). */
export async function supprimerMessageAssistant(
  userId: string,
  conversationId: string,
  messageId: string
): Promise<boolean> {
  const resultat = await prisma.assistantMessage.deleteMany({
    where: { id: messageId, conversationId, role: 'assistant', conversation: { userId } },
  })
  return resultat.count > 0
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Métadonnées persistées d'un message utilisateur (lues par le lot 3 au rechargement). */
export interface MetadonneesMessageUtilisateur {
  conversationId: string
  creeA: string
  piecesJointesIds: string[]
  piecesJointes: PieceJointeChat[]
  contexte?: ContexteEcran
}

export async function enregistrerMessageUtilisateur(
  userId: string,
  conversationId: string,
  message: { id: string; parts: MessageMedicAssist['parts'] },
  metadonnees: MetadonneesMessageUtilisateur
): Promise<void> {
  await prisma.assistantMessage.create({
    data: {
      id: message.id,
      conversationId,
      role: 'user',
      parts: message.parts as object[],
      metadonnees: metadonnees as unknown as object,
    },
  })
  await toucherConversation(userId, conversationId)
}

/** Parties à persister : sans les parties `data-*`, qui ne servent qu'au transport. */
export function partiesAPersister(parts: MessageMedicAssist['parts']): MessageMedicAssist['parts'] {
  return parts.filter(p => !(typeof p.type === 'string' && p.type.startsWith('data-')))
}

/** Vrai si le message porte un contenu utile (texte non vide ou partie d'outil). */
export function messageNonVide(parts: MessageMedicAssist['parts']): boolean {
  return parts.some(p => {
    if (p.type === 'text') return typeof p.text === 'string' && p.text.trim() !== ''
    return p.type === 'dynamic-tool' || p.type.startsWith('tool-')
  })
}

/** Ids des actions proposées pendant le tour (parties `tool-proposer_action` abouties). */
export function idsActionsProposees(parts: MessageMedicAssist['parts']): string[] {
  const ids = new Set<string>()
  for (const partie of parts) {
    if (partie.type !== 'tool-proposer_action') continue
    const p = partie as { state?: string; output?: unknown }
    if (p.state !== 'output-available' || typeof p.output !== 'object' || p.output === null) {
      continue
    }
    const actionId = (p.output as Record<string, unknown>).actionId
    if (typeof actionId === 'string' && actionId.length > 0 && actionId.length <= 100) {
      ids.add(actionId)
    }
  }
  return [...ids]
}

// ---------------------------------------------------------------------------
// Usages
// ---------------------------------------------------------------------------

export interface LigneUsage {
  userId: string
  conversationId: string | null
  messageId: string | null
  fournisseur: string
  modele: string
  mode: Mode
  usage: UsageTokens
  coutUsd: number
  dureeMs: number
  /** Code d'erreur (CodeErreurChat) seulement, jamais un message du fournisseur. */
  erreur?: string | null
}

export async function enregistrerUsage(ligne: LigneUsage): Promise<void> {
  await prisma.assistantUsage.create({
    data: {
      userId: ligne.userId,
      conversationId: ligne.conversationId,
      messageId: ligne.messageId,
      fournisseur: ligne.fournisseur,
      modele: ligne.modele,
      mode: ligne.mode,
      tokensEntree: ligne.usage.entree,
      tokensSortie: ligne.usage.sortie,
      tokensCacheLecture: ligne.usage.cacheLecture ?? 0,
      tokensCacheEcriture: ligne.usage.cacheEcriture ?? 0,
      coutUsd: Number.isFinite(ligne.coutUsd) ? Math.max(0, ligne.coutUsd) : 0,
      dureeMs: Math.max(0, Math.round(ligne.dureeMs)),
      erreur: ligne.erreur ?? null,
    },
  })
}

// ---------------------------------------------------------------------------
// Fin de tour
// ---------------------------------------------------------------------------

export interface FinDeTour {
  userId: string
  conversationId: string
  /** Message assistant à persister ; absent si la réponse est vide. */
  message?: {
    id: string
    parts: MessageMedicAssist['parts']
    metadonnees: MetadonneesMessage
  }
  usage: Omit<LigneUsage, 'userId' | 'conversationId' | 'messageId'>
  /** Usages annexes (titre, mode rapide), sans message rattaché. */
  usagesAnnexes?: Omit<LigneUsage, 'userId' | 'conversationId' | 'messageId'>[]
}

export interface ResultatFinDeTour {
  messageEnregistre: boolean
  usageEnregistre: boolean
  actionsRattachees: number
}

function nomErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.name : typeof erreur
}

/**
 * Persiste la fin d'un tour : message assistant, usage (toujours, même en erreur), usages
 * annexes, rattachement des actions et `dernierMessageA`. Chaque écriture est isolée : un échec
 * est journalisé (nom d'erreur seulement) et n'empêche ni les suivantes ni la fin du flux.
 */
export async function enregistrerFinDeTour(fin: FinDeTour): Promise<ResultatFinDeTour> {
  const { userId, conversationId } = fin
  const resultat: ResultatFinDeTour = {
    messageEnregistre: false,
    usageEnregistre: false,
    actionsRattachees: 0,
  }

  if (fin.message) {
    try {
      await prisma.assistantMessage.create({
        data: {
          id: fin.message.id,
          conversationId,
          role: 'assistant',
          parts: fin.message.parts as object[],
          metadonnees: fin.message.metadonnees as object,
        },
      })
      resultat.messageEnregistre = true
    } catch (erreur) {
      console.error('[medic-assist/chat] message assistant non enregistré', nomErreur(erreur))
    }
  }

  const messageId = resultat.messageEnregistre && fin.message ? fin.message.id : null

  try {
    await enregistrerUsage({ ...fin.usage, userId, conversationId, messageId })
    resultat.usageEnregistre = true
  } catch (erreur) {
    console.error('[medic-assist/chat] usage non enregistré', nomErreur(erreur))
  }

  for (const annexe of fin.usagesAnnexes ?? []) {
    try {
      await enregistrerUsage({ ...annexe, userId, conversationId, messageId: null })
    } catch (erreur) {
      console.error('[medic-assist/chat] usage annexe non enregistré', nomErreur(erreur))
    }
  }

  if (messageId && fin.message) {
    const ids = idsActionsProposees(fin.message.parts)
    if (ids.length > 0) {
      try {
        const maj = await prisma.assistantAction.updateMany({
          where: { id: { in: ids }, userId, conversationId },
          data: { messageId },
        })
        resultat.actionsRattachees = maj.count
      } catch (erreur) {
        console.error('[medic-assist/chat] actions non rattachées', nomErreur(erreur))
      }
    }
  }

  try {
    await toucherConversation(userId, conversationId)
  } catch (erreur) {
    console.error('[medic-assist/chat] conversation non mise à jour', nomErreur(erreur))
  }

  return resultat
}
