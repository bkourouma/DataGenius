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

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'
import type {
  ContexteEcran,
  MessageMedicAssist,
  MetadonneesMessage,
  Mode,
  UsageTokens,
} from '@/lib/medic-assist/contrats'

import { TITRE_PAR_DEFAUT_CONVERSATION } from './conversations'

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

/**
 * Crée la conversation côté serveur, au titre par défaut. `tourEnCoursJusqua` pose le verrou du
 * tour dès la création (verrou.ts) : aucune autre requête ne peut y lancer un tour concurrent.
 */
export async function creerConversationChat(
  userId: string,
  tourEnCoursJusqua?: Date
): Promise<ConversationChat> {
  const cree = await prisma.assistantConversation.create({
    data: {
      userId,
      titre: TITRE_PAR_DEFAUT_CONVERSATION,
      ...(tourEnCoursJusqua ? { tourEnCoursJusqua } : {}),
    },
    select: { id: true, titre: true },
  })
  return { id: cree.id, titre: cree.titre }
}

/**
 * Supprime une conversation que cette requête vient de créer et qui n'a encore AUCUN message
 * (refus du verrou après création). Propriétaire et absence de message dans le même `where`.
 */
export async function supprimerConversationVide(
  userId: string,
  conversationId: string
): Promise<boolean> {
  const resultat = await prisma.assistantConversation.deleteMany({
    where: { id: conversationId, userId, messages: { none: {} } },
  })
  return resultat.count > 0
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

/**
 * Message de la conversation (du propriétaire) qui porte déjà cet id client : idempotence de
 * l'envoi. `null` si aucun.
 */
export async function trouverMessageParIdClient(
  userId: string,
  conversationId: string,
  idClient: string
): Promise<{ id: string; role: string } | null> {
  return prisma.assistantMessage.findFirst({
    where: { conversationId, idClient, conversation: { userId } },
    select: { id: true, role: true },
  })
}

/** Vrai si l'erreur est la violation d'une contrainte unique (code Prisma P2002). */
export function estViolationUnicite(erreur: unknown): boolean {
  if (erreur instanceof Prisma.PrismaClientKnownRequestError) return erreur.code === 'P2002'
  return (
    typeof erreur === 'object' &&
    erreur !== null &&
    (erreur as { code?: unknown }).code === 'P2002'
  )
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

/**
 * Enregistre le message utilisateur. `idClient` (id du UIMessage du client) est soumis à la
 * contrainte unique (conversationId, idClient) : un doublon lève une erreur P2002
 * (`estViolationUnicite`), que l'appelant traduit en 409 `message_deja_recu`.
 */
export async function enregistrerMessageUtilisateur(
  userId: string,
  conversationId: string,
  message: { id: string; parts: MessageMedicAssist['parts']; idClient?: string },
  metadonnees: MetadonneesMessageUtilisateur
): Promise<void> {
  await prisma.assistantMessage.create({
    data: {
      id: message.id,
      conversationId,
      role: 'user',
      parts: message.parts as object[],
      metadonnees: metadonnees as unknown as object,
      ...(message.idClient ? { idClient: message.idClient } : {}),
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

function donneesUsage(ligne: LigneUsage) {
  return {
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
  }
}

export async function enregistrerUsage(ligne: LigneUsage): Promise<void> {
  await prisma.assistantUsage.create({ data: donneesUsage(ligne) })
}

// ---------------------------------------------------------------------------
// Fin de tour
// ---------------------------------------------------------------------------

export type UsageDeTour = Omit<LigneUsage, 'userId' | 'conversationId' | 'messageId'>

export interface FinDeTour {
  userId: string
  conversationId: string
  /** Message assistant à persister ; absent si la réponse est vide. */
  message?: {
    id: string
    parts: MessageMedicAssist['parts']
    metadonnees: MetadonneesMessage
  }
  /** Usage principal du tour (rattaché au message s'il est enregistré). */
  usage: UsageDeTour
  /**
   * Usages des autres modèles du même tour (modèle de secours après bascule), une ligne par
   * modèle, rattachées au message comme l'usage principal.
   */
  usagesModeles?: UsageDeTour[]
  /** Usages annexes (titre, mode rapide), sans message rattaché. */
  usagesAnnexes?: UsageDeTour[]
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
 * Persiste la fin d'un tour dans UNE transaction : message assistant, usage principal, usages
 * des autres modèles, usages annexes, rattachement des actions et `dernierMessageA`. Tout ou
 * rien : jamais de message sans usage ni d'actions rattachées à un message absent.
 *
 * Le verrou du tour n'est PAS libéré ici : l'appelant le libère après les dernières écritures
 * du tour (suppression de l'ancienne réponse d'une régénération), voir executer.ts.
 *
 * Si la transaction échoue, l'échec est journalisé (nom d'erreur seulement) et SEULS les usages
 * sont retentés hors transaction, sans message rattaché : le coût ne doit pas se perdre (quota
 * journalier, suivi des coûts). Ne lève jamais : la fin du flux n'est pas bloquée.
 */
export async function enregistrerFinDeTour(fin: FinDeTour): Promise<ResultatFinDeTour> {
  const { userId, conversationId } = fin
  const lignesTour = [fin.usage, ...(fin.usagesModeles ?? [])]
  const annexes = fin.usagesAnnexes ?? []

  try {
    return await prisma.$transaction(async tx => {
      const resultat: ResultatFinDeTour = {
        messageEnregistre: false,
        usageEnregistre: false,
        actionsRattachees: 0,
      }
      let messageId: string | null = null
      if (fin.message) {
        await tx.assistantMessage.create({
          data: {
            id: fin.message.id,
            conversationId,
            role: 'assistant',
            parts: fin.message.parts as object[],
            metadonnees: fin.message.metadonnees as object,
          },
        })
        resultat.messageEnregistre = true
        messageId = fin.message.id
      }

      for (const ligne of lignesTour) {
        await tx.assistantUsage.create({
          data: donneesUsage({ ...ligne, userId, conversationId, messageId }),
        })
      }
      resultat.usageEnregistre = true

      for (const annexe of annexes) {
        await tx.assistantUsage.create({
          data: donneesUsage({ ...annexe, userId, conversationId, messageId: null }),
        })
      }

      if (messageId && fin.message) {
        const ids = idsActionsProposees(fin.message.parts)
        if (ids.length > 0) {
          const maj = await tx.assistantAction.updateMany({
            where: { id: { in: ids }, userId, conversationId },
            data: { messageId },
          })
          resultat.actionsRattachees = maj.count
        }
      }

      await tx.assistantConversation.updateMany({
        where: { id: conversationId, userId },
        data: { dernierMessageA: new Date() },
      })
      return resultat
    })
  } catch (erreur) {
    journal.erreur('chat : fin de tour non enregistrée', {
      domaine: 'chat',
      conversationId,
      evenement: 'fin_de_tour_non_enregistree',
      erreur: nomErreur(erreur),
    })
  }

  // Repli : usages seuls, hors transaction, sans message rattaché.
  let usageEnregistre = false
  for (const [index, ligne] of [...lignesTour, ...annexes].entries()) {
    try {
      await enregistrerUsage({ ...ligne, userId, conversationId, messageId: null })
      if (index < lignesTour.length) usageEnregistre = true
    } catch (erreur) {
      journal.erreur('chat : usage non enregistré', {
        domaine: 'chat',
        conversationId,
        evenement: 'usage_non_enregistre',
        erreur: nomErreur(erreur),
      })
    }
  }
  return { messageEnregistre: false, usageEnregistre, actionsRattachees: 0 }
}
