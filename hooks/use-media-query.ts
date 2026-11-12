"use client"

/**
 * Requetes media cote React, sures pour le rendu serveur.
 *
 * Le serveur ne connait pas la largeur de l'ecran : le rendu serveur et le tout
 * premier rendu client (hydratation) partent de `valeurInitiale` (faux par defaut,
 * c'est-a-dire la mise en page bureau), si bien que le HTML d'hydratation est
 * identique des deux cotes et que React ne signale aucun ecart. `useSyncExternalStore`
 * relit ensuite la vraie valeur avant la premiere peinture, sans clignotement visible.
 *
 * Pour tout ce qui peut se regler en CSS (masquer une colonne, empiler des cartes),
 * preferer les classes Tailwind `sm:`/`md:` : elles ne coutent aucun rendu React.
 * Ce hook sert aux cas ou le rendu change de structure (vue cartes, colonnes par defaut).
 */

import { useCallback, useSyncExternalStore } from "react"

/** Largeur (exclue) a partir de laquelle l'ecran n'est plus « petit » : point de rupture `md` de Tailwind. */
export const LARGEUR_MOBILE_PX = 768

function disponible(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
}

/**
 * `true` quand la requete media correspond.
 *
 * @param requete  ex. `"(max-width: 767px)"`
 * @param valeurInitiale  valeur pour le rendu serveur et l'hydratation (faux par defaut)
 */
export function useMediaQuery(requete: string, valeurInitiale = false): boolean {
  const abonner = useCallback(
    (rappel: () => void) => {
      // matchMedia absent (environnement de test, vieux navigateur) : rien a ecouter.
      if (!disponible()) return () => {}
      const liste = window.matchMedia(requete)
      // Safari < 14 n'a que addListener/removeListener.
      if (typeof liste.addEventListener === "function") {
        liste.addEventListener("change", rappel)
        return () => liste.removeEventListener("change", rappel)
      }
      liste.addListener?.(rappel)
      return () => liste.removeListener?.(rappel)
    },
    [requete]
  )

  const lire = useCallback(
    () => (disponible() ? window.matchMedia(requete).matches : valeurInitiale),
    [requete, valeurInitiale]
  )

  return useSyncExternalStore(abonner, lire, () => valeurInitiale)
}

/** `true` sous 768 px (telephone, petite tablette en portrait). Faux cote serveur et a l'hydratation. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${LARGEUR_MOBILE_PX - 1}px)`)
}
