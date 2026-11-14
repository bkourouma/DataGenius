/**
 * Assemblage PUR de la liste des avis (aucun acces base) : les lignes brutes lues par
 * depot-prisma.ts deviennent des AvisAdminDto du lot 0.
 *
 * - `AssistantAvis.note` vaut +1 ou -1 ; le DTO dit `positif` / `negatif`.
 * - Fournisseur et modele de la reponse viennent des `metadonnees` du message (le schema
 *   AssistantMessage n'a pas de colonnes pour eux).
 * - Question = dernier message utilisateur AVANT la reponse notee, meme conversation.
 */

import { MetadonneesMessageSchema } from '@/lib/medic-assist/contrats'

import type { AvisAdminDto, ValeurAvis } from './dependances'

export const LONGUEUR_MAX_QUESTION = 500
export const LONGUEUR_MAX_EXTRAIT = 1000
export const NOM_AUTEUR_INCONNU = '—'

export interface AvisBrut {
  id: string
  messageId: string
  userId: string
  /** +1 ou -1. */
  note: number
  commentaire: string | null
  createdAt: Date
}

export interface MessageBrut {
  id: string
  conversationId: string
  /** Parties du message au format UI du SDK : [{ type: 'text', text }, ...]. */
  parts: unknown
  metadonnees: unknown
  createdAt: Date
}

export interface QuestionBrute {
  conversationId: string
  parts: unknown
  createdAt: Date
}

export interface DonneesAvisBrutes {
  /** Page demandee plus une ligne (la page suivante, si elle existe). */
  avis: AvisBrut[]
  messages: MessageBrut[]
  /** Messages utilisateur des conversations concernees. */
  questions: QuestionBrute[]
  /** userId -> nom affiche. */
  auteurs: ReadonlyMap<string, string>
}

export const valeurDeNote = (note: number): ValeurAvis => (note > 0 ? 'positif' : 'negatif')

/** Texte brut des parties de type texte (une chaine simple est acceptee telle quelle). */
export function texteBrutDesParties(parts: unknown): string {
  if (typeof parts === 'string') return parts.trim()
  if (!Array.isArray(parts)) return ''
  return parts
    .map(p =>
      p && typeof p === 'object' && (p as { type?: unknown }).type === 'text'
        ? String((p as { text?: unknown }).text ?? '')
        : ''
    )
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function tronquer(texte: string, maximum: number): string {
  const caracteres = Array.from(texte)
  if (caracteres.length <= maximum) return texte
  return (
    caracteres
      .slice(0, maximum - 1)
      .join('')
      .trimEnd() + '…'
  )
}

const SchemaModeleMessage = MetadonneesMessageSchema.pick({ fournisseur: true, modele: true })

function modeleDuMessage(metadonnees: unknown) {
  const lu = SchemaModeleMessage.safeParse(metadonnees ?? {})
  return lu.success ? lu.data : {}
}

export function assemblerAvis(
  donnees: DonneesAvisBrutes,
  taille: number
): { avis: AvisAdminDto[]; suivant: string | null } {
  const page = donnees.avis.slice(0, taille)
  const suivant = donnees.avis.length > taille ? donnees.avis[taille].id : null

  const messages = new Map(donnees.messages.map(m => [m.id, m]))

  // Messages utilisateur de chaque conversation, du plus recent au plus ancien.
  const questionsParConversation = new Map<string, QuestionBrute[]>()
  for (const q of donnees.questions) {
    const liste = questionsParConversation.get(q.conversationId) ?? []
    liste.push(q)
    questionsParConversation.set(q.conversationId, liste)
  }
  for (const liste of questionsParConversation.values()) {
    liste.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  const avis: AvisAdminDto[] = []
  for (const brut of page) {
    const message = messages.get(brut.messageId)
    // Message disparu (suppression en cascade en cours) : l'avis n'est pas affichable.
    if (!message) continue
    const precedente = questionsParConversation
      .get(message.conversationId)
      ?.find(q => q.createdAt.getTime() <= message.createdAt.getTime())
    const question = tronquer(texteBrutDesParties(precedente?.parts), LONGUEUR_MAX_QUESTION)
    const reponse = tronquer(texteBrutDesParties(message.parts), LONGUEUR_MAX_EXTRAIT)
    const { fournisseur, modele } = modeleDuMessage(message.metadonnees)
    const commentaire = brut.commentaire?.trim()
    avis.push({
      id: brut.id,
      messageId: brut.messageId,
      conversationId: message.conversationId,
      valeur: valeurDeNote(brut.note),
      ...(commentaire ? { commentaire } : {}),
      utilisateur: {
        id: brut.userId,
        nom: donnees.auteurs.get(brut.userId) ?? NOM_AUTEUR_INCONNU,
      },
      ...(question ? { question } : {}),
      ...(reponse ? { reponse } : {}),
      ...(fournisseur ? { fournisseur } : {}),
      ...(modele ? { modele } : {}),
      creeA: brut.createdAt.toISOString(),
    })
  }

  return { avis, suivant }
}
