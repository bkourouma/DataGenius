'use client'

/**
 * Seul fichier de l'interface qui importe `@ai-sdk/react` et `ai` (SDK v7, voir
 * lib/medic-assist/contrats/NOTES-SDK.md).
 *
 * Contrat d'envoi (`CorpsRequeteChat`, contrats/chat.ts) : on n'envoie au
 * serveur que le DERNIER message utilisateur (parties texte seulement, les
 * pieces jointes passent par `piecesJointesIds`) ; le serveur relit l'historique
 * en base. Pour une regeneration, le corps porte `trigger: 'regenerate-message'`
 * et `messageId`. La metadata d'affichage locale des messages (pieces jointes,
 * contexte) n'est JAMAIS envoyee : le corps ne contient que ce que le contrat definit.
 *
 * Le `conversationId` peut apparaitre apres le montage (creation a l'envoi du
 * premier message) : il est lu dans une ref au moment de la requete, et l'`id`
 * du chat du SDK reste STABLE pour ne pas reinitialiser les messages en cours
 * de flux.
 */

import { useCallback, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import {
  SCHEMAS_PARTIES_DONNEES,
  type ContexteEcran,
  type CorpsRequeteChat,
  type DeclencheurChat,
  type MessageMedicAssist,
} from '@/lib/medic-assist/contrats'
import { extraireCodeErreur, type CodeErreurChat } from './erreurs-chat'
import type { EnvoiMessage, MessageUI, StatutChat } from './types'

const URL_CHAT = '/api/medic-assist/chat'

export interface OptionsUseMedicChat {
  /** Identifiant de la conversation, null tant qu'elle n'est pas creee. */
  conversationId: string | null
  /** Messages deja enregistres (lus une seule fois, au montage). */
  messagesInitiaux: MessageUI[]
  /** Appele quand une reponse est terminee (le titre est genere cote serveur). */
  onTermine?: () => void
  /**
   * Repli : le serveur a cree la conversation (partie `data-conversation` ou
   * `metadata.conversationId`) alors que le client n'en avait pas. Le chemin
   * nominal reste `creerConversation()` AVANT le premier envoi.
   */
  onConversationCreee?: (id: string) => void
  /** Titre annonce par le serveur (partie `data-conversation`) : met la liste a jour. */
  onTitre?: (id: string, titre: string) => void
}

export interface ResultatUseMedicChat {
  messages: MessageUI[]
  statut: StatutChat
  erreur: Error | null
  /** Code type de l'erreur courante (null sans erreur). */
  codeErreur: CodeErreurChat | null
  envoyer: (envoi: EnvoiMessage, conversationId?: string) => void
  arreter: () => void
  /** Vrai apres un arret demande par la personne, jusqu'a l'envoi ou la regeneration suivants. */
  arrete: boolean
  regenerer: (messageId: string) => void
  reessayer: () => void
}

/** Ce que la saisie fixe avant l'envoi et que `prepareSendMessagesRequest` relit. */
export interface OptionsRequete {
  modeProfond?: boolean
  piecesJointesIds?: string[]
  contexteEcran?: ContexteEcran
}

/** Corps reellement envoye : exactement `CorpsRequeteChat` (le schema serveur est strict). */
export type CorpsEnvoye = CorpsRequeteChat

/** Sous-ensemble structurel d'un message, assez pour fabriquer le corps. */
interface MessageBrut {
  id: string
  role: string
  parts: ReadonlyArray<{ type: string; text?: unknown }>
  metadata?: unknown
}

/** Dernier message utilisateur, reduit a ses parties texte (le contrat refuse le reste). */
function dernierMessageUtilisateur(messages: readonly MessageBrut[]): CorpsRequeteChat['message'] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'user') continue
    const parts = message.parts.flatMap((p) =>
      p.type === 'text' && typeof p.text === 'string' && p.text.length > 0
        ? [{ type: 'text' as const, text: p.text }]
        : [],
    )
    if (parts.length === 0) return undefined
    return {
      id: message.id,
      role: 'user',
      parts,
    }
  }
  return undefined
}

/**
 * Fabrique le corps de POST /api/medic-assist/chat (fonction pure, testee seule).
 *
 * - `trigger` du SDK ('submit-message' | 'regenerate-message') est repris ;
 *   toute valeur commencant par `regenerate` vaut regeneration.
 * - Regeneration SANS `messageId` (bouton « Reessayer » apres un echec avant
 *   toute reponse) : le serveur exige un messageId, on retombe donc sur un
 *   envoi normal du dernier message utilisateur.
 */
export function fabriquerCorpsRequete(entree: {
  id: string
  messages: readonly MessageBrut[]
  trigger: string
  messageId?: string
  conversationId: string | null
  options: OptionsRequete
}): CorpsEnvoye {
  const { options } = entree
  const regeneration = entree.trigger.startsWith('regenerate')
  const declencheur: DeclencheurChat =
    regeneration && entree.messageId && entree.conversationId
      ? 'regenerate-message'
      : 'submit-message'

  const corps: CorpsEnvoye = {
    id: entree.id,
    ...(entree.conversationId ? { conversationId: entree.conversationId } : {}),
    trigger: declencheur,
    modeProfond: options.modeProfond ?? false,
    piecesJointesIds: options.piecesJointesIds ?? [],
    ...(options.contexteEcran ? { contexteEcran: options.contexteEcran } : {}),
  }
  if (declencheur === 'regenerate-message') {
    corps.messageId = entree.messageId
  }
  const message = dernierMessageUtilisateur(entree.messages)
  if (message) corps.message = message
  return corps
}

/** Id de conversation annonce par le serveur (partie `data-conversation` ou metadonnees de message). */
export function idConversationAnnonce(source: {
  type?: string
  data?: unknown
  metadata?: unknown
}): string | null {
  const brut =
    source.type === 'data-conversation'
      ? (source.data as { conversationId?: unknown } | undefined)?.conversationId
      : (source.metadata as { conversationId?: unknown } | undefined)?.conversationId
  return typeof brut === 'string' && brut ? brut : null
}

/** Titre annonce avec la partie `data-conversation` (`{ conversationId, titre? }`, ou `{ id, titre? }`). */
export function titreConversationAnnonce(source: {
  type?: string
  data?: unknown
}): { id: string; titre: string } | null {
  if (source.type !== 'data-conversation') return null
  const data = source.data as { conversationId?: unknown; id?: unknown; titre?: unknown } | undefined
  const id = data?.conversationId ?? data?.id
  const titre = typeof data?.titre === 'string' ? data.titre.trim() : ''
  return typeof id === 'string' && id && titre ? { id, titre } : null
}

let compteurId = 0
function nouvelIdLocal(): string {
  compteurId += 1
  return `medic-assist-nouvelle-${Date.now()}-${compteurId}`
}

export function useMedicChat({
  conversationId,
  messagesInitiaux,
  onTermine,
  onConversationCreee,
  onTitre,
}: OptionsUseMedicChat): ResultatUseMedicChat {
  const idConversation = useRef<string | null>(conversationId)
  if (conversationId) idConversation.current = conversationId
  const optionsRequete = useRef<OptionsRequete>({})
  // Options du dernier envoi : reprises par regenerer / reessayer.
  const dernieresOptions = useRef<OptionsRequete>({})
  const surTermine = useRef(onTermine)
  surTermine.current = onTermine
  const surCreee = useRef(onConversationCreee)
  surCreee.current = onConversationCreee
  const surTitre = useRef(onTitre)
  surTitre.current = onTitre
  // Identifiant du chat du SDK : fixe pour toute la vie du composant.
  const idChat = useRef<string>(conversationId ?? nouvelIdLocal())
  const transport = useRef<DefaultChatTransport<MessageMedicAssist> | null>(null)
  if (!transport.current) {
    transport.current = new DefaultChatTransport<MessageMedicAssist>({
      api: URL_CHAT,
      prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
        body: fabriquerCorpsRequete({
          id,
          messages,
          trigger,
          messageId,
          conversationId: idConversation.current,
          options: optionsRequete.current,
        }),
      }),
    })
  }

  const annoncer = useCallback((id: string | null) => {
    if (!id || id === idConversation.current) return
    idConversation.current = id
    surCreee.current?.(id)
  }, [])

  const chat = useChat<MessageMedicAssist>({
    id: idChat.current,
    // Nos messages structurels (types.ts) sont des UIMessage serialises : cast
    // unique, les parties inconnues sont tolerees par le SDK.
    messages: messagesInitiaux as unknown as MessageMedicAssist[],
    transport: transport.current,
    dataPartSchemas: SCHEMAS_PARTIES_DONNEES,
    onData: (partie) => {
      annoncer(idConversationAnnonce(partie))
      const titre = titreConversationAnnonce(partie)
      if (titre) surTitre.current?.(titre.id, titre.titre)
    },
    // Pas de toast : l'erreur est exposee (`erreur`, `codeErreur`) et le fil affiche
    // un bandeau avec « Reessayer ».
    onFinish: ({ message }) => {
      annoncer(idConversationAnnonce(message))
      surTermine.current?.()
    },
  })

  const { sendMessage, regenerate, stop, clearError } = chat
  const [arrete, setArrete] = useState(false)
  const messagesRef = useRef(chat.messages)
  messagesRef.current = chat.messages

  const envoyer = useCallback(
    (envoi: EnvoiMessage, idNouveau?: string) => {
      setArrete(false)
      if (idNouveau) idConversation.current = idNouveau
      optionsRequete.current = {
        modeProfond: envoi.modeProfond,
        piecesJointesIds: envoi.piecesJointes.map((p) => p.id),
        contexteEcran: envoi.contexteEcran,
      }
      dernieresOptions.current = optionsRequete.current
      const contexte = envoi.contexteEcran?.titre ?? envoi.contexteEcran?.libelle
      // Metadonnees du MESSAGE (affichees par le fil : pieces jointes, contexte joint).
      const metadata = {
        ...(envoi.piecesJointes.length > 0
          ? { piecesJointes: envoi.piecesJointes.map((p) => ({ id: p.id, nom: p.nom })) }
          : {}),
        ...(contexte ? { contexte } : {}),
      }
      void sendMessage({
        text: envoi.texte,
        // Ces metadonnees d'affichage depassent MetadonneesMessage : cast documente.
        ...(Object.keys(metadata).length > 0
          ? { metadata: metadata as unknown as MessageMedicAssist['metadata'] }
          : {}),
      })
    },
    [sendMessage],
  )

  const regenerer = useCallback(
    (messageId: string) => {
      setArrete(false)
      optionsRequete.current = dernieresOptions.current
      void regenerate({ messageId })
    },
    [regenerate],
  )

  const reessayer = useCallback(() => {
    clearError()
    setArrete(false)
    optionsRequete.current = dernieresOptions.current
    const dernier = messagesRef.current[messagesRef.current.length - 1]
    // Derniere reponse partielle : on la regenere ; sinon (echec avant toute
    // reponse) `fabriquerCorpsRequete` renvoie le dernier message utilisateur.
    void regenerate(dernier?.role === 'assistant' ? { messageId: dernier.id } : undefined)
  }, [clearError, regenerate])

  return {
    messages: chat.messages as unknown as MessageUI[],
    statut: chat.status,
    erreur: chat.error ?? null,
    codeErreur: chat.error ? extraireCodeErreur(chat.error) : null,
    envoyer,
    arrete,
    arreter: () => {
      setArrete(true)
      void stop()
    },
    regenerer,
    reessayer,
  }
}
