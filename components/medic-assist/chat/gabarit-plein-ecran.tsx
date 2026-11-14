import type { ReactNode } from 'react'

/**
 * Gabarit plein ecran de Medic Assist, SANS toucher au layout du tableau de bord.
 *
 * Le `<main>` de la coquille defile et enveloppe la page dans un conteneur
 * `max-w-[1800px]` avec `px-4 py-5 sm:px-6 lg:px-8 lg:py-7`. On annule ce
 * remplissage par des marges negatives de meme valeur et on fixe la hauteur a
 * celle du `<main>` : 100dvh - barre haute (h-14 = 3.5rem) sous 1024 px, toute
 * la hauteur au-dela (la navigation passe dans le rail lateral). Le conteneur parent
 * mesure alors (remplissage haut - marge haute) + hauteur + (- marge basse +
 * remplissage bas) = hauteur du `<main>` : rien ne deborde, pas de defilement de
 * page ; seuls la liste, le fil et le panneau defilent, chacun dans sa zone.
 * `pb-safe` laisse la place a la barre de gestes des mobiles.
 */
export function GabaritPleinEcran({ children }: { children: ReactNode }) {
  return (
    <div className="pb-safe -mx-4 -my-5 h-[calc(100dvh-3.5rem)] overflow-hidden bg-background sm:-mx-6 lg:-mx-8 lg:-my-7 lg:h-dvh">
      {children}
    </div>
  )
}
