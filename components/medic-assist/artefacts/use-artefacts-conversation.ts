'use client'

/**
 * Liste des artefacts d'une conversation (dernière version de chacun, ordre de création).
 *
 * Rafraîchie quand `conversationId` change, sur appel de `rafraichir()` (le chat le déclenche
 * quand un nouvel artefact apparaît dans le fil) et sur l'événement `window`
 * `medic-assist:artefact-cree`, que n'importe quel composant peut émettre avec
 * `signalerArtefactCree(conversationId?)` : sans `conversationId`, toute liste se rafraîchit.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  resumeVersClient,
  type ResumeArtefactClient,
} from '@/lib/medic-assist/artefacts/client-mapper'
import type { ArtefactResumeReponse } from '@/lib/medic-assist/artefacts/reponse'

export const EVENEMENT_ARTEFACT_CREE = 'medic-assist:artefact-cree'

/** Onglet du panneau : résumé de la dernière version d'un artefact (`majA` ISO 8601). */
export type ResumeArtefact = ResumeArtefactClient

export type EtatListe = 'chargement' | 'pret' | 'erreur'

export interface RetourUseArtefactsConversation {
  artefacts: ResumeArtefact[]
  etat: EtatListe
  rafraichir: () => void
}

export interface DetailArtefactCree {
  conversationId?: string
}

/** Annonce qu'un artefact vient d'être créé ou modifié (les listes concernées se rechargent). */
export function signalerArtefactCree(conversationId?: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<DetailArtefactCree>(EVENEMENT_ARTEFACT_CREE, { detail: { conversationId } })
  )
}

export function useArtefactsConversation(conversationId: string): RetourUseArtefactsConversation {
  const [artefacts, setArtefacts] = useState<ResumeArtefact[]>([])
  const [etat, setEtat] = useState<EtatListe>('chargement')
  const [compteur, setCompteur] = useState(0)
  const conversationRef = useRef<string | null>(null)

  useEffect(() => {
    const controleur = new AbortController()
    // Nouvelle conversation : on repart d'une liste vide ; simple rafraîchissement : on garde
    // la liste affichée pendant le rechargement.
    if (conversationRef.current !== conversationId) {
      conversationRef.current = conversationId
      setArtefacts([])
      setEtat('chargement')
    }
    void (async () => {
      try {
        const reponse = await fetch(
          `/api/medic-assist/artefacts?conversationId=${encodeURIComponent(conversationId)}`,
          { credentials: 'same-origin', signal: controleur.signal }
        )
        if (!reponse.ok) throw new Error(String(reponse.status))
        const corps = (await reponse.json()) as { artefacts?: ArtefactResumeReponse[] }
        if (controleur.signal.aborted) return
        setArtefacts(Array.isArray(corps.artefacts) ? corps.artefacts.map(resumeVersClient) : [])
        setEtat('pret')
      } catch {
        if (controleur.signal.aborted) return
        setEtat('erreur')
      }
    })()
    return () => controleur.abort()
  }, [conversationId, compteur])

  const rafraichir = useCallback(() => setCompteur(n => n + 1), [])

  useEffect(() => {
    const surEvenement = (evenement: Event) => {
      const detail = (evenement as CustomEvent<DetailArtefactCree | undefined>).detail
      if (!detail?.conversationId || detail.conversationId === conversationId) rafraichir()
    }
    window.addEventListener(EVENEMENT_ARTEFACT_CREE, surEvenement)
    return () => window.removeEventListener(EVENEMENT_ARTEFACT_CREE, surEvenement)
  }, [conversationId, rafraichir])

  return { artefacts, etat, rafraichir }
}
