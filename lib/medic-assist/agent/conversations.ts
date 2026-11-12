/**
 * Service des conversations de Medic Assist (lot 1) : liste, création, lecture, modification,
 * suppression et avis. Couche service : les routes ne contiennent aucune logique.
 *
 * Isolation (architecture §3) : chaque lecture ou écriture par id porte la condition de
 * propriétaire (`userId`) ou de partage dans le MÊME `where`. Un objet qui n'existe pas et un
 * objet qui n'est pas au lecteur sont indiscernables : les fonctions renvoient `null`.
 */

import { z } from 'zod'

import { prisma } from '@/lib/db/client'
import { auteurDansPerimetreLecteur, contenuAuPerimetreCourant } from '@/lib/auth/data-access'
import { supprimerPieceJointe } from '@/lib/medic-assist/pieces-jointes/service'
import type { ActionProposee } from '@/lib/medic-assist/contrats/actions'
import {
  AvisCorpsSchema,
  type ArtefactResumeDto,
  type AvisCorps,
  type AvisDto,
  type ConversationDetailDto,
  type ConversationPartageeDto,
  type ConversationResumeDto,
  type CreerConversationCorps,
  type ListeConversationsDto,
  type ListeConversationsQuery,
  type ModifierConversationCorps,
} from '@/lib/medic-assist/contrats/api'
import type { MessagePersiste, MetadonneesMessage } from '@/lib/medic-assist/contrats/chat'
import { texteMultiligneSurSchema, type PersonneDto } from '@/lib/medic-assist/contrats/communs'
import { LIMITES, TITRE_PAR_DEFAUT_CONVERSATION, type TypeArtefact } from '@/lib/medic-assist/contrats/constantes'
import type { ContexteExecution } from '@/lib/medic-assist/contrats/contexte'

/** Ce que le service lit du contexte d'exécution : l'utilisateur courant. */
export type ContexteConversations = Pick<ContexteExecution, 'userId'> & Partial<Pick<ContexteExecution, 'scope'>>

/** Réexport : le titre de repli (valeur technique) est défini dans les contrats. */
export { TITRE_PAR_DEFAUT_CONVERSATION }

/** Nombre maximal de conversations repérées par la recherche dans le texte des messages. */
const MAX_CONVERSATIONS_RECHERCHE_MESSAGES = 500

/** Clés de métadonnées de message renvoyées au client (le coût et les jetons restent côté admin). */
const METADONNEES_PUBLIQUES = [
  'conversationId',
  'creeA',
  'fournisseur',
  'modele',
  'mode',
  'dureeMs',
  'etapes',
  'raisonFin',
  'interrompu',
  'piecesJointesIds',
  'piecesJointes',
  'contexte',
] as const

// ---------------------------------------------------------------------------
// Briques
// ---------------------------------------------------------------------------

type LigneConversation = {
  id: string
  titre: string
  epinglee: boolean
  archivee: boolean
  dernierMessageA: Date
  createdAt: Date
}

function titreAffiche(titre: string | null | undefined): string {
  const net = (titre ?? '').trim()
  return net.length > 0 ? net : TITRE_PAR_DEFAUT_CONVERSATION
}

function nomComplet(u: { firstName: string; lastName: string }): string {
  return `${u.firstName} ${u.lastName}`.trim()
}

function personne(u: { id: string; firstName: string; lastName: string }): PersonneDto {
  return { id: u.id, nom: nomComplet(u) }
}

function versResume(
  c: LigneConversation,
  nbMessages: number,
  partagee: boolean
): ConversationResumeDto {
  return {
    id: c.id,
    titre: titreAffiche(c.titre),
    epinglee: c.epinglee,
    archivee: c.archivee,
    dernierMessageA: c.dernierMessageA.toISOString(),
    creeA: c.createdAt.toISOString(),
    partagee,
    nbMessages,
  }
}

/** Nombre de messages par conversation, en une requête agrégée. */
async function compterMessages(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()
  const lignes = await prisma.assistantMessage.groupBy({
    by: ['conversationId'],
    where: { conversationId: { in: ids } },
    _count: { _all: true },
  })
  return new Map(lignes.map(l => [l.conversationId, l._count._all]))
}

/** Conversations de `userId` qui ont au moins un partage sortant, en une requête agrégée. */
async function idsPartagees(userId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const lignes = await prisma.assistantPartage.groupBy({
    by: ['ressourceId'],
    where: { ressourceType: 'conversation', deUserId: userId, ressourceId: { in: ids } },
    _count: { _all: true },
  })
  return new Set(lignes.map(l => l.ressourceId))
}

function encoderCurseur(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url')
}

function decoderCurseur(curseur: string | undefined): string | undefined {
  if (!curseur) return undefined
  const id = Buffer.from(curseur, 'base64url').toString('utf8')
  return id.length > 0 && id.length <= 100 ? id : undefined
}

/** Échappe les jokers de LIKE pour que la recherche soit littérale. */
function echapperLike(texte: string): string {
  return texte.replace(/[\\%_]/g, c => `\\${c}`)
}

/**
 * Ids des conversations de `userId` dont un message contient `recherche` (parties de type
 * texte seulement, insensible à la casse). Requête paramétrée : aucune concaténation de SQL.
 */
async function conversationsParTexteDeMessage(
  userId: string,
  recherche: string
): Promise<string[]> {
  const motif = `%${echapperLike(recherche)}%`
  const lignes = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT c."id"
    FROM "assistant_conversations" c
    JOIN "assistant_messages" m ON m."conversationId" = c."id"
    WHERE c."userId" = ${userId}
      AND jsonb_typeof(m."parts") = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(m."parts") AS p
        WHERE p->>'type' = 'text' AND p->>'text' ILIKE ${motif}
      )
    LIMIT ${MAX_CONVERSATIONS_RECHERCHE_MESSAGES}`
  return lignes.map(l => l.id)
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

/**
 * Conversations de l'utilisateur (non archivées par défaut, ou les archivées seulement),
 * épinglées d'abord, puis dernier message décroissant, puis id. Recherche insensible à la casse
 * sur le titre et sur le texte des messages. Pagination par curseur opaque.
 * `partageesAvecMoi` (première page seulement) : conversations partagées avec le lecteur.
 */
export async function listerConversations(
  ctx: ContexteConversations,
  query: ListeConversationsQuery
): Promise<ListeConversationsDto> {
  const { userId } = ctx
  const archivee = query.archivees === true
  const taille = Math.min(query.taille ?? LIMITES.taillePageListeDefaut, LIMITES.taillePageListeMax)
  const recherche = query.recherche?.trim() ?? ''
  const curseur = decoderCurseur(query.curseur)
  const droits = ctx.scope?.donnees
  const dateMin = droits?.regles.size && !droits.administrateur ? droits.depuis : undefined

  const idsParTexte = recherche ? await conversationsParTexteDeMessage(userId, recherche) : []
  const filtreRecherche = recherche
    ? {
        OR: [
          { titre: { contains: recherche, mode: 'insensitive' as const } },
          { id: { in: idsParTexte } },
        ],
      }
    : {}

  const lignes = await prisma.assistantConversation.findMany({
    where: { userId, archivee, ...filtreRecherche, ...(dateMin && { createdAt: { gte: dateMin } }) },
    orderBy: [{ epinglee: 'desc' }, { dernierMessageA: 'desc' }, { id: 'asc' }],
    take: taille + 1,
    ...(curseur ? { cursor: { id: curseur }, skip: 1 } : {}),
    select: {
      id: true,
      titre: true,
      epinglee: true,
      archivee: true,
      dernierMessageA: true,
      createdAt: true,
    },
  })

  const page = lignes.slice(0, taille)
  const suivant = lignes.length > taille ? encoderCurseur(page[page.length - 1].id) : null
  const ids = page.map(c => c.id)
  const [nbMessages, partagees] = await Promise.all([
    compterMessages(ids),
    idsPartagees(userId, ids),
  ])

  const conversations = page.map(c => versResume(c, nbMessages.get(c.id) ?? 0, partagees.has(c.id)))
  const partageesAvecMoi = curseur ? [] : await listerPartageesAvecMoi(ctx, archivee, recherche)

  return { conversations, partageesAvecMoi, suivant }
}

async function listerPartageesAvecMoi(
  ctx: ContexteConversations,
  archivee: boolean,
  recherche: string
): Promise<ConversationPartageeDto[]> {
  const { userId } = ctx
  const droits = ctx.scope?.donnees
  const partages = await prisma.assistantPartage.findMany({
    where: { ressourceType: 'conversation', aUserId: userId },
    select: { id: true, ressourceId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: LIMITES.taillePageListeMax,
  })
  if (partages.length === 0) return []

  const conversations = await prisma.assistantConversation.findMany({
    where: {
      id: { in: partages.map(p => p.ressourceId) },
      archivee,
      ...(recherche ? { titre: { contains: recherche, mode: 'insensitive' as const } } : {}),
    },
    select: {
      id: true,
      titre: true,
      epinglee: true,
      archivee: true,
      dernierMessageA: true,
      createdAt: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  const accesParConversation = await Promise.all(conversations.map(c =>
    contenuAuPerimetreCourant(droits, c.createdAt) && auteurDansPerimetreLecteur(droits, userId, c.user.id),
  ))
  const visibles = conversations.filter((_, index) => accesParConversation[index])
  const nbMessages = await compterMessages(visibles.map(c => c.id))
  const partageParConversation = new Map(partages.map(p => [p.ressourceId, p]))

  return visibles
    .flatMap(c => {
      const partage = partageParConversation.get(c.id)
      if (!partage) return []
      const dto: ConversationPartageeDto = {
        ...versResume(c, nbMessages.get(c.id) ?? 0, false),
        partageId: partage.id,
        proprietaire: personne(c.user),
        partageeA: partage.createdAt.toISOString(),
      }
      return [dto]
    })
    .sort((a, b) => b.dernierMessageA.localeCompare(a.dernierMessageA) || a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------------------
// Création, modification, suppression
// ---------------------------------------------------------------------------

/** Crée une conversation vide pour l'utilisateur (titre fourni, sinon le titre de repli). */
export async function creerConversation(
  ctx: ContexteConversations,
  corps: CreerConversationCorps
): Promise<ConversationResumeDto> {
  const cree = await prisma.assistantConversation.create({
    data: { userId: ctx.userId, titre: titreAffiche(corps.titre) },
    select: {
      id: true,
      titre: true,
      epinglee: true,
      archivee: true,
      dernierMessageA: true,
      createdAt: true,
    },
  })
  return versResume(cree, 0, false)
}

/**
 * Lit une conversation : propriétaire OU partage vers le lecteur, dans une seule requête de
 * conversation dont le `where` porte l'id ET la condition d'accès. `null` si elle n'existe pas
 * ou n'est pas accessible. Un lecteur par partage reçoit `lectureSeule: true`, sans les actions.
 */
export async function lireConversation(
  ctx: ContexteConversations,
  id: string
): Promise<ConversationDetailDto | null> {
  const { userId } = ctx
  const partages = await prisma.assistantPartage.findMany({
    where: { ressourceType: 'conversation', aUserId: userId, ressourceId: id },
    select: { ressourceId: true },
  })

  const conv = await prisma.assistantConversation.findFirst({
    where: {
      id,
      OR: [{ userId }, { id: { in: partages.map(p => p.ressourceId) } }],
    },
    select: {
      id: true,
      userId: true,
      titre: true,
      epinglee: true,
      archivee: true,
      dernierMessageA: true,
      createdAt: true,
      user: { select: { id: true, firstName: true, lastName: true } },
      messages: {
        where: { role: { in: ['user', 'assistant'] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, role: true, parts: true, metadonnees: true, createdAt: true },
      },
    },
  })
  if (!conv) return null
  if (!contenuAuPerimetreCourant(ctx.scope?.donnees, conv.createdAt) ||
      !(await auteurDansPerimetreLecteur(ctx.scope?.donnees, userId, conv.userId))) return null

  const proprietaireId = conv.userId
  const estProprietaire = proprietaireId === userId
  const idsMessages = conv.messages.map(m => m.id)

  const [avis, artefacts, actions] = await Promise.all([
    idsMessages.length === 0
      ? Promise.resolve([])
      : prisma.assistantAvis.findMany({
          where: { userId, messageId: { in: idsMessages } },
          select: { messageId: true, note: true },
        }),
    prisma.assistantArtefact.findMany({
      where: { conversationId: conv.id, userId: proprietaireId },
      orderBy: [{ version: 'desc' }],
      select: { racineId: true, type: true, titre: true, version: true, createdAt: true },
    }),
    // Les actions (destinataires, paramètres) restent au propriétaire.
    estProprietaire
      ? prisma.assistantAction.findMany({
          where: { conversationId: conv.id, userId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : Promise.resolve([]),
  ])

  const noteParMessage = new Map(avis.map(a => [a.messageId, a.note]))

  const messages: MessagePersiste[] = conv.messages.map(m => {
    const note = noteParMessage.get(m.id)
    const metadata: Record<string, unknown> = {}
    const brutes = (m.metadonnees ?? {}) as Record<string, unknown>
    for (const cle of METADONNEES_PUBLIQUES) {
      if (brutes[cle] !== undefined) metadata[cle] = brutes[cle]
    }
    if (m.role === 'assistant') {
      metadata.avis = note === undefined ? null : note > 0 ? 'positif' : 'negatif'
    }
    return {
      id: m.id,
      role: m.role as 'user' | 'assistant',
      parts: m.parts as MessagePersiste['parts'],
      metadata: metadata as MetadonneesMessage,
      creeA: m.createdAt.toISOString(),
    }
  })

  // Dernière version de chaque racine ; `id` = racineId, stable d'une version à l'autre.
  const dernieres = new Map<string, ArtefactResumeDto>()
  for (const a of artefacts) {
    if (dernieres.has(a.racineId)) continue
    dernieres.set(a.racineId, {
      id: a.racineId,
      type: a.type as TypeArtefact,
      titre: a.titre,
      version: a.version,
      majA: a.createdAt.toISOString(),
    })
  }

  return {
    id: conv.id,
    titre: titreAffiche(conv.titre),
    epinglee: conv.epinglee,
    archivee: conv.archivee,
    creeA: conv.createdAt.toISOString(),
    dernierMessageA: conv.dernierMessageA.toISOString(),
    messages,
    artefacts: [...dernieres.values()].sort((a, b) => a.majA.localeCompare(b.majA)),
    actions: actions.map(versActionProposee),
    lectureSeule: !estProprietaire,
    proprietaire: personne(conv.user),
  }
}

type LigneAction = {
  id: string
  conversationId: string
  type: string
  parametres: unknown
  statut: string
  resultat: unknown
  createdAt: Date
  executeeA: Date | null
}

function versActionProposee(a: LigneAction): ActionProposee {
  const resultat = (a.resultat ?? undefined) as ActionProposee['resultat']
  const parametres = a.parametres as Record<string, unknown> | null
  const resumeStocke = typeof parametres?.resume === 'string' ? parametres.resume : undefined
  return {
    id: a.id,
    type: a.type,
    statut: a.statut,
    parametres: a.parametres,
    ...(resumeStocke ? { resume: resumeStocke } : {}),
    resultat,
    conversationId: a.conversationId,
    creeA: a.createdAt.toISOString(),
    traiteeA: a.executeeA?.toISOString(),
  } as ActionProposee
}

/**
 * Modifie titre, épinglage ou archivage : PROPRIÉTAIRE seulement (`updateMany` sur `{ id, userId }`).
 * `null` si la conversation n'existe pas ou n'est pas au lecteur (un lecteur par partage aussi).
 */
export async function modifierConversation(
  ctx: ContexteConversations,
  id: string,
  corps: ModifierConversationCorps
): Promise<ConversationResumeDto | null> {
  const { userId } = ctx
  const data: { titre?: string; epinglee?: boolean; archivee?: boolean } = {}
  if (corps.titre !== undefined) data.titre = titreAffiche(corps.titre)
  if (corps.epinglee !== undefined) data.epinglee = corps.epinglee
  if (corps.archivee !== undefined) data.archivee = corps.archivee

  const { count } = await prisma.assistantConversation.updateMany({
    where: { id, userId },
    data,
  })
  if (count === 0) return null

  const conv = await prisma.assistantConversation.findFirst({
    where: { id, userId },
    select: {
      id: true,
      titre: true,
      epinglee: true,
      archivee: true,
      dernierMessageA: true,
      createdAt: true,
    },
  })
  if (!conv) return null
  const [nbMessages, partagees] = await Promise.all([
    compterMessages([id]),
    idsPartagees(userId, [id]),
  ])
  return versResume(conv, nbMessages.get(id) ?? 0, partagees.has(id))
}

/** Résultat d'une suppression : les pièces jointes à nettoyer par la route (fichiers sur disque). */
export interface ResultatSuppressionConversation {
  piecesJointesIds: string[]
}

/**
 * Supprime une conversation du PROPRIÉTAIRE, dans une transaction. La base supprime en cascade
 * les messages (et leurs avis) et les actions. Les jeux et artefacts de la conversation passent
 * sinon à SetNull : on les supprime explicitement pour ne laisser aucun orphelin, SAUF les
 * artefacts enregistrés dans Mes analyses, épinglés ou programmés (et les jeux qu'ils lisent),
 * qui survivent à la conversation par conception du schéma. Les partages de la conversation et
 * des artefacts supprimés tombent avec eux. Les pièces jointes ne sont PAS supprimées ici : leurs
 * ids sont renvoyés pour `finaliserSuppressionPiecesJointes`. `null` si rien n'est au lecteur.
 */
export async function supprimerConversation(
  ctx: ContexteConversations,
  id: string
): Promise<ResultatSuppressionConversation | null> {
  const { userId } = ctx
  return prisma.$transaction(async tx => {
    const existe = await tx.assistantConversation.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!existe) return null

    const pieces = await tx.assistantPieceJointe.findMany({
      where: { conversationId: id, userId },
      select: { id: true },
    })

    const artefacts = await tx.assistantArtefact.findMany({
      where: { conversationId: id, userId },
      select: { id: true, racineId: true, enregistre: true, jeuxDeDonneesIds: true },
    })
    const racines = [...new Set(artefacts.map(a => a.racineId))]
    const [epingles, rapports] =
      racines.length === 0
        ? [[], []]
        : await Promise.all([
            tx.assistantEpingle.findMany({
              where: { artefactRacineId: { in: racines } },
              select: { artefactRacineId: true },
            }),
            tx.assistantRapportProgramme.findMany({
              where: { artefactRacineId: { in: racines } },
              select: { artefactRacineId: true },
            }),
          ])
    const gardees = new Set<string>([
      ...artefacts.filter(a => a.enregistre).map(a => a.racineId),
      ...epingles.map(e => e.artefactRacineId),
      ...rapports.map(r => r.artefactRacineId),
    ])
    const aSupprimer = artefacts.filter(a => !gardees.has(a.racineId))
    const jeuxGardes = artefacts
      .filter(a => gardees.has(a.racineId))
      .flatMap(a => (Array.isArray(a.jeuxDeDonneesIds) ? (a.jeuxDeDonneesIds as string[]) : []))

    if (aSupprimer.length > 0) {
      const racinesSupprimees = [...new Set(aSupprimer.map(a => a.racineId))]
      await tx.assistantPartage.deleteMany({
        where: {
          ressourceType: 'artefact',
          deUserId: userId,
          ressourceId: { in: [...racinesSupprimees, ...aSupprimer.map(a => a.id)] },
        },
      })
      await tx.assistantArtefact.deleteMany({
        where: { id: { in: aSupprimer.map(a => a.id) }, userId },
      })
    }
    await tx.assistantJeuDeDonnees.deleteMany({
      where: { conversationId: id, userId, id: { notIn: jeuxGardes } },
    })
    await tx.assistantPartage.deleteMany({
      where: { ressourceType: 'conversation', ressourceId: id, deUserId: userId },
    })

    const { count } = await tx.assistantConversation.deleteMany({ where: { id, userId } })
    if (count === 0) return null
    return { piecesJointesIds: pieces.map(p => p.id) }
  })
}

/**
 * Seconde étape de la suppression : pour chaque pièce jointe, supprime la ligne puis le fichier
 * (`supprimerPieceJointe`, propriétaire dans le where). Un échec est journalisé par son nom
 * seulement (ni message ni chemin) et ne bloque ni les autres pièces ni la suppression de la
 * conversation, déjà faite. Un dernier `deleteMany` retire les lignes restantes de
 * l'utilisateur (`id IN ids AND userId`).
 */
export async function finaliserSuppressionPiecesJointes(
  ctx: ContexteConversations,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return
  for (const id of ids) {
    try {
      await supprimerPieceJointe(ctx, id)
    } catch (erreur) {
      console.error('[medic-assist] nettoyage de pièce jointe en échec :', nomErreur(erreur))
    }
  }
  await prisma.assistantPieceJointe.deleteMany({ where: { id: { in: ids }, userId: ctx.userId } })
}

/** Nom de l'erreur seulement : ni message, ni pile (pas de fuite dans les journaux). */
export function nomErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.name : 'ErreurInconnue'
}

// ---------------------------------------------------------------------------
// Avis
// ---------------------------------------------------------------------------

/**
 * Corps accepté par POST /messages/[id]/avis : la forme du contrat `{ valeur, commentaire? }` ou
 * la forme `{ note: 1 | -1, commentaire? }` alignée sur la colonne `AssistantAvis.note`.
 */
export const AvisCorpsEntreeSchema = z.union([
  AvisCorpsSchema,
  z.object({
    note: z.union([z.literal(1), z.literal(-1)]),
    commentaire: texteMultiligneSurSchema(1_000, 'Commentaire facultatif.').optional(),
  }),
])
export type AvisCorpsEntree = z.infer<typeof AvisCorpsEntreeSchema>

/** Ramène les deux formes du corps à `{ valeur, commentaire }`. */
export function normaliserAvis(corps: AvisCorpsEntree): AvisCorps {
  if ('note' in corps) {
    return { valeur: corps.note > 0 ? 'positif' : 'negatif', commentaire: corps.commentaire }
  }
  return corps
}

/**
 * Enregistre (upsert sur `(messageId, userId)`) ou retire (`valeur: null`) l'avis de l'utilisateur
 * sur un message de l'assistant d'une conversation VISIBLE (la sienne ou partagée avec lui), le
 * contrôle étant dans le `where` du message. `null` si le message n'existe pas ou est invisible.
 */
export async function enregistrerAvis(
  ctx: ContexteConversations,
  messageId: string,
  corps: AvisCorps
): Promise<AvisDto | null> {
  const { userId } = ctx
  const partages = await prisma.assistantPartage.findMany({
    where: { ressourceType: 'conversation', aUserId: userId },
    select: { ressourceId: true },
  })

  const message = await prisma.assistantMessage.findFirst({
    where: {
      id: messageId,
      role: 'assistant',
      conversation: { OR: [{ userId }, { id: { in: partages.map(p => p.ressourceId) } }] },
    },
    select: { id: true },
  })
  if (!message) return null

  if (corps.valeur === null) {
    await prisma.assistantAvis.deleteMany({ where: { messageId, userId } })
    return { messageId, valeur: null, majA: new Date().toISOString() }
  }

  const note = corps.valeur === 'positif' ? 1 : -1
  const commentaire = corps.commentaire ?? null
  const avis = await prisma.assistantAvis.upsert({
    where: { messageId_userId: { messageId, userId } },
    create: { messageId, userId, note, commentaire },
    update: { note, commentaire },
    select: { note: true, commentaire: true, updatedAt: true },
  })
  return {
    messageId,
    valeur: avis.note > 0 ? 'positif' : 'negatif',
    ...(avis.commentaire ? { commentaire: avis.commentaire } : {}),
    majA: avis.updatedAt.toISOString(),
  }
}
