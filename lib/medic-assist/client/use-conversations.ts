'use client'

/**
 * Hooks react-query (v5) des conversations. Le QueryClientProvider est fourni
 * par la page de chat.
 */

import { useCallback } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  creerConversation,
  lireConversation,
  listerConversations,
  modifierConversation,
  supprimerConversation,
  type ListeConversationsNormalisee,
  type ModificationConversation,
} from './api'
import type { ConversationDetail, ConversationResume } from './types'

export const clesConversations = {
  toutes: ['medic-assist', 'conversations'] as const,
  listes: ['medic-assist', 'conversations', 'liste'] as const,
  liste: (recherche: string, archivees: boolean) =>
    ['medic-assist', 'conversations', 'liste', { recherche, archivees }] as const,
  detail: (id: string) => ['medic-assist', 'conversations', 'detail', id] as const,
}

export function useListeConversations({
  recherche,
  archivees,
  actif = true,
}: {
  recherche: string
  archivees: boolean
  /** Faux : la requete n'est pas lancee (ex. groupe des archivees replie). */
  actif?: boolean
}) {
  const terme = recherche.trim()
  return useQuery({
    queryKey: clesConversations.liste(terme, archivees),
    queryFn: ({ signal }) => listerConversations({ recherche: terme, archivees }, signal),
    placeholderData: keepPreviousData,
    enabled: actif,
  })
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: clesConversations.detail(id ?? ''),
    queryFn: ({ signal }) => lireConversation(id as string, signal),
    enabled: !!id,
  })
}

/** Invalide listes et details (ex. apres une reponse : le titre est genere cote serveur). */
export function useInvaliderConversations() {
  const client = useQueryClient()
  return useCallback(
    () => client.invalidateQueries({ queryKey: clesConversations.toutes }),
    [client],
  )
}

/** Pose le titre annonce par le serveur dans les listes et le detail en cache (sans requete). */
export function useMettreAJourTitre() {
  const client = useQueryClient()
  return useCallback(
    (id: string, titre: string) => {
      client.setQueriesData<ListeConversationsNormalisee>(
        { queryKey: clesConversations.listes },
        (liste) =>
          liste && {
            ...liste,
            moi: liste.moi.map((c) => (c.id === id ? { ...c, titre } : c)),
          },
      )
      client.setQueryData<ConversationDetail>(clesConversations.detail(id), (detail) =>
        detail ? { ...detail, titre } : detail,
      )
    },
    [client],
  )
}

export function useCreerConversation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (titre?: string) => creerConversation(titre),
    onSuccess: () => client.invalidateQueries({ queryKey: clesConversations.listes }),
  })
}

type InstantaneListes = [readonly unknown[], ListeConversationsNormalisee | undefined][]

function appliquer(
  c: ConversationResume,
  patch: ModificationConversation,
): ConversationResume {
  return {
    ...c,
    ...(patch.titre !== undefined ? { titre: patch.titre } : {}),
    ...(patch.epinglee !== undefined ? { epinglee: patch.epinglee } : {}),
    ...(patch.archivee !== undefined ? { archivee: patch.archivee } : {}),
  }
}

export function useModifierConversation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ModificationConversation }) =>
      modifierConversation(id, patch),
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: clesConversations.listes })
      const avant: InstantaneListes = client.getQueriesData<ListeConversationsNormalisee>({
        queryKey: clesConversations.listes,
      })
      client.setQueriesData<ListeConversationsNormalisee>(
        { queryKey: clesConversations.listes },
        (liste) =>
          liste && {
            ...liste,
            moi: liste.moi.map((c) => (c.id === id ? appliquer(c, patch) : c)),
          },
      )
      return { avant }
    },
    onError: (_erreur, _variables, contexte) => {
      for (const [cle, donnees] of contexte?.avant ?? []) client.setQueryData(cle, donnees)
    },
    onSettled: (_donnees, _erreur, { id }) => {
      void client.invalidateQueries({ queryKey: clesConversations.listes })
      void client.invalidateQueries({ queryKey: clesConversations.detail(id) })
    },
  })
}

export function useSupprimerConversation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => supprimerConversation(id),
    onSuccess: (_donnees, id) => {
      client.removeQueries({ queryKey: clesConversations.detail(id) })
      return client.invalidateQueries({ queryKey: clesConversations.listes })
    },
  })
}
