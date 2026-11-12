'use client'

/**
 * Defilement « colle en bas » d'un fil de messages : suit le bas du conteneur
 * tant que la personne n'est pas remontee ; reprend quand elle redescend a
 * moins de ~80 px du bas ou via `allerEnBas`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const SEUIL_PX = 80
/** Ecart tolere (px) pour dire « le fil est en bas » ou « il n'y a rien a defiler ». */
const TOLERANCE_BAS_PX = 8

function mouvementReduit(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function useDefilementColle({
  dependances,
  actif = true,
}: {
  dependances: readonly unknown[]
  /** Faux (ecran d'accueil sans message) : le fil reste en haut, rien n'est colle en bas. */
  actif?: boolean
}) {
  const refConteneur = useRef<HTMLDivElement | null>(null)
  const [colle, setColle] = useState(true)
  const colleRef = useRef(true)
  const dernierHaut = useRef(0)
  const [peutDescendre, setPeutDescendre] = useState(false)

  const definirColle = useCallback((valeur: boolean) => {
    colleRef.current = valeur
    setColle(valeur)
  }, [])

  /** Vrai seulement si le fil depasse la zone visible ET n'est pas deja en bas. */
  const recalculerBouton = useCallback(() => {
    const el = refConteneur.current
    if (!el) return
    const reste = el.scrollHeight - el.scrollTop - el.clientHeight
    const defilable = el.scrollHeight - el.clientHeight > TOLERANCE_BAS_PX
    setPeutDescendre(defilable && reste > TOLERANCE_BAS_PX)
  }, [])

  const surDefilement = useCallback(() => {
    const el = refConteneur.current
    if (!el) return
    recalculerBouton()
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const monte = el.scrollTop < dernierHaut.current - 1
    dernierHaut.current = el.scrollTop
    if (monte) {
      if (colleRef.current) definirColle(false)
    } else if (distance <= SEUIL_PX) {
      if (!colleRef.current) definirColle(true)
    }
  }, [definirColle, recalculerBouton])

  const allerEnBas = useCallback(() => {
    const el = refConteneur.current
    if (!el) return
    definirColle(true)
    if (typeof el.scrollTo === 'function' && !mouvementReduit()) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
    dernierHaut.current = el.scrollTop
    recalculerBouton()
  }, [definirColle, recalculerBouton])

  // Le contenu a change : on suit le bas, de facon instantanee, si on est colle.
  useEffect(() => {
    const el = refConteneur.current
    if (!el) return
    if (!actif) {
      el.scrollTop = 0
      dernierHaut.current = 0
      if (!colleRef.current) definirColle(true)
    } else if (colleRef.current) {
      el.scrollTop = el.scrollHeight
      dernierHaut.current = el.scrollTop
    }
    recalculerBouton()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependances, actif])

  // La taille du fil ou de son contenu change sans evenement de defilement (image, mise en page,
  // liste raccourcie ou videe) : on refait le calcul.
  useEffect(() => {
    const el = refConteneur.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observateur = new ResizeObserver(() => recalculerBouton())
    observateur.observe(el)
    if (el.firstElementChild) observateur.observe(el.firstElementChild)
    return () => observateur.disconnect()
  }, [recalculerBouton])

  return {
    refConteneur,
    collé: colle,
    /** Bouton « Aller en bas » : fil defilable et personne en bas. */
    afficherAllerEnBas: !colle && peutDescendre,
    allerEnBas,
    surDefilement,
  }
}
