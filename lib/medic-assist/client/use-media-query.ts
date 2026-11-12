'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Etat d'une media query. Faux cote serveur et quand `matchMedia` n'existe pas
 * (tests, vieux navigateurs) : les composants retombent alors sur la mise en
 * page la plus etroite.
 */
export function useMediaQuery(requete: string): boolean {
  const abonner = useCallback(
    (rappel: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {}
      }
      const media = window.matchMedia(requete)
      media.addEventListener?.('change', rappel)
      return () => media.removeEventListener?.('change', rappel)
    },
    [requete],
  )
  const lire = useCallback(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(requete).matches
  }, [requete])
  return useSyncExternalStore(abonner, lire, () => false)
}

/** Points de rupture de Tailwind utilises par l'espace de chat. */
export const REQUETE_LG = '(min-width: 1024px)'
export const REQUETE_XL = '(min-width: 1280px)'
