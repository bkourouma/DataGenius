import type {
  ConversationDetailDto,
  ConversationPartageeDto,
  ConversationResumeDto,
} from '@/lib/medic-assist/contrats'
import type { ConversationDetail, ConversationResume, MessageUI, ValeurAvis } from './types'

/**
 * Appels HTTP de l'interface de chat vers /api/medic-assist/*.
 *
 * Ce fichier regroupe TOUTES les hypotheses du lot 3 sur la forme des reponses
 * des API des autres lots : si un lot change une forme, seul ce fichier bouge.
 * Les erreurs sont normalisees en `ErreurApiMedicAssist` (statut + message
 * court) pour que les composants affichent un toast sans connaitre le format.
 */

export class ErreurApiMedicAssist extends Error {
  readonly statut: number
  constructor(statut: number, message: string) {
    super(message)
    this.name = 'ErreurApiMedicAssist'
    this.statut = statut
  }
}

/** Lit le message d'erreur d'une reponse (`{ error }`, `{ message }` ou texte). */
async function lireMessageErreur(reponse: Response): Promise<string> {
  try {
    const corps: unknown = await reponse.clone().json()
    if (corps && typeof corps === 'object') {
      const objet = corps as Record<string, unknown>
      for (const cle of ['error', 'message', 'erreur']) {
        const valeur = objet[cle]
        if (typeof valeur === 'string' && valeur) return valeur
      }
    }
  } catch {
    // corps non JSON
  }
  return reponse.statusText || String(reponse.status)
}

/**
 * Appel JSON. Corps objet -> serialise en JSON ; FormData laisse tel quel.
 * Leve `ErreurApiMedicAssist` si la reponse n'est pas 2xx. Retourne `undefined`
 * pour 204.
 */
export async function appelApi<T = unknown>(
  url: string,
  init: Omit<RequestInit, 'body'> & { corps?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { corps, headers, ...reste } = init
  const enTetes = new Headers(headers)
  let body: BodyInit | undefined
  if (corps instanceof FormData) {
    body = corps
  } else if (corps !== undefined) {
    enTetes.set('Content-Type', 'application/json')
    body = JSON.stringify(corps)
  }
  const reponse = await fetch(url, { credentials: 'same-origin', ...reste, headers: enTetes, body })
  if (!reponse.ok) throw new ErreurApiMedicAssist(reponse.status, await lireMessageErreur(reponse))
  if (reponse.status === 204) return undefined as T
  return (await reponse.json()) as T
}

/** Deballe `{ data: X }` (convention des API du depot) ou renvoie la valeur telle quelle. */
export function deballer<T>(corps: unknown): T {
  if (corps && typeof corps === 'object' && 'data' in (corps as Record<string, unknown>)) {
    return (corps as { data: T }).data
  }
  return corps as T
}

/* -------------------------------------------------------------------------- */
/* Conversations (lot 1) : DTO reels de contrats/api.ts -> types internes      */
/* -------------------------------------------------------------------------- */
/*
 * - GET    /api/medic-assist/conversations?recherche=&archivees=1
 *     -> `ListeConversationsDto` = `{ conversations, partageesAvecMoi, suivant }`
 *        (la cle `partagees` et les formes `[]` / enveloppe `{ data }` sont aussi
 *        toleres). `ConversationPartageeDto.proprietaire.nom` devient `partageePar`.
 * - POST   /api/medic-assist/conversations  { titre? } -> ConversationResumeDto
 * - GET    /api/medic-assist/conversations/[id] -> ConversationDetailDto
 * - PATCH  /api/medic-assist/conversations/[id] { titre?, epinglee?, archivee? }
 * - DELETE /api/medic-assist/conversations/[id]
 * - POST   /api/medic-assist/messages/[id]/avis { valeur, commentaire? }
 *
 * Le reste de l'interface manipule `ConversationResume` / `ConversationDetail`
 * (types.ts) : TOUT le mappage DTO -> types internes est dans ce fichier.
 */

export interface FiltreListeConversations {
  recherche?: string
  archivees?: boolean
}

export interface ListeConversationsNormalisee {
  moi: ConversationResume[]
  partagees: ConversationResume[]
}

export interface ModificationConversation {
  titre?: string
  epinglee?: boolean
  archivee?: boolean
}

function enTableau<T>(valeur: unknown): T[] {
  return Array.isArray(valeur) ? (valeur as T[]) : []
}

/**
 * `ConversationResumeDto` (ou ancienne forme `miseAJour`) -> `ConversationResume`.
 * `partagee` du DTO (MA conversation partagee avec d'autres) n'est PAS repris :
 * dans nos types, `partageeAvecMoi` veut dire « partagee AVEC moi » (lecture seule).
 */
export function conversationDepuisDto(
  dto: ConversationResumeDto | (Partial<ConversationResumeDto> & { id: string; miseAJour?: string }),
): ConversationResume {
  const ancienne = dto as { miseAJour?: string }
  return {
    id: dto.id,
    titre: dto.titre ?? null,
    epinglee: dto.epinglee === true,
    archivee: dto.archivee === true,
    miseAJour: dto.dernierMessageA ?? ancienne.miseAJour ?? dto.creeA ?? '',
  }
}

function partageeDepuisDto(dto: ConversationPartageeDto): ConversationResume {
  const proprietaire = dto.proprietaire?.nom
  return {
    ...conversationDepuisDto(dto),
    partageeAvecMoi: true,
    ...(proprietaire ? { partageePar: proprietaire } : {}),
  }
}

/** Normalise la reponse de la liste en `{ moi, partagees }` (tableau vide si absent). */
export function normaliserListeConversations(corps: unknown): ListeConversationsNormalisee {
  const contenu = deballer<unknown>(corps)
  let moi: ConversationResumeDto[] = []
  let partagees: ConversationPartageeDto[] = []
  if (Array.isArray(contenu)) {
    moi = contenu as ConversationResumeDto[]
  } else if (contenu && typeof contenu === 'object') {
    const objet = contenu as Record<string, unknown>
    moi = enTableau(objet.conversations)
    partagees = enTableau(objet.partageesAvecMoi ?? objet.partagees)
  }
  return {
    moi: moi.map(conversationDepuisDto),
    partagees: partagees.map(partageeDepuisDto),
  }
}

/** `ConversationDetailDto` -> `ConversationDetail` (messages au format persiste). */
export function detailDepuisDto(dto: ConversationDetailDto): ConversationDetail {
  const lectureSeule = dto.lectureSeule === true
  const proprietaire = dto.proprietaire?.nom
  return {
    ...conversationDepuisDto(dto),
    // `MessagePersiste` est un `UIMessage` serialise : structurellement un `MessageUI`.
    messages: (dto.messages ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts as unknown as MessageUI['parts'],
      ...(m.metadata !== undefined ? { metadata: m.metadata } : {}),
    })),
    artefactIds: (dto.artefacts ?? []).map((a) => a.id),
    lectureSeule,
    // Lecture seule = conversation recue d'un autre : affichee « partagee avec moi ».
    ...(lectureSeule ? { partageeAvecMoi: true } : {}),
    ...(lectureSeule && proprietaire ? { partageePar: proprietaire } : {}),
  }
}

export async function listerConversations(
  filtre: FiltreListeConversations = {},
  signal?: AbortSignal,
): Promise<ListeConversationsNormalisee> {
  const params = new URLSearchParams()
  const recherche = filtre.recherche?.trim()
  if (recherche) params.set('recherche', recherche)
  if (filtre.archivees) params.set('archivees', '1')
  const requete = params.toString()
  const corps = await appelApi<unknown>(
    `/api/medic-assist/conversations${requete ? `?${requete}` : ''}`,
    { signal },
  )
  return normaliserListeConversations(corps)
}

export async function creerConversation(titre?: string): Promise<ConversationResume> {
  const corps = await appelApi<unknown>('/api/medic-assist/conversations', {
    method: 'POST',
    corps: titre ? { titre } : {},
  })
  return conversationDepuisDto(deballer<ConversationResumeDto>(corps))
}

export async function lireConversation(
  id: string,
  signal?: AbortSignal,
): Promise<ConversationDetail> {
  const corps = await appelApi<unknown>(
    `/api/medic-assist/conversations/${encodeURIComponent(id)}`,
    { signal },
  )
  return detailDepuisDto(deballer<ConversationDetailDto>(corps))
}

export async function modifierConversation(
  id: string,
  patch: ModificationConversation,
): Promise<void> {
  await appelApi(`/api/medic-assist/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    corps: patch,
  })
}

export async function supprimerConversation(id: string): Promise<void> {
  await appelApi(`/api/medic-assist/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

/** SIGNATURE FIGEE : appelee par la barre d'actions des messages. */
export async function envoyerAvis(
  messageId: string,
  valeur: ValeurAvis,
  commentaire?: string,
): Promise<void> {
  await appelApi(`/api/medic-assist/messages/${encodeURIComponent(messageId)}/avis`, {
    method: 'POST',
    // Corps exact de AvisCorpsSchema (contrats/api.ts) : le serveur convertit en +1 / -1.
    corps: { valeur, ...(commentaire ? { commentaire } : {}) },
  })
}
