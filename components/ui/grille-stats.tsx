import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Grille responsive de cartes statistiques.
 *
 * Sous 640 px : `mobile` colonnes ; des `sm` : 2 colonnes ; des `lg` : `max` colonnes.
 * Les classes sont ecrites en dur (table de correspondance) pour que Tailwind les
 * detecte. Les enfants ont `min-w-0` : un long nombre se tronque au lieu de pousser
 * la colonne hors de l'ecran.
 */

export interface GrilleStatsProps {
  children: React.ReactNode
  /** Colonnes sous 640 px (defaut 2). */
  mobile?: 1 | 2
  /** Colonnes maximales en desktop, des `lg` (defaut 4). */
  max?: 2 | 3 | 4
  className?: string
}

const COLONNES_MOBILE = {
  1: "grid-cols-1",
  2: "grid-cols-2",
} as const

const COLONNES_MAX = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const

export function GrilleStats({
  children,
  mobile = 2,
  max = 4,
  className,
}: GrilleStatsProps) {
  return (
    <div
      className={cn(
        "grid gap-2.5 sm:gap-4 [&>*]:min-w-0",
        COLONNES_MOBILE[mobile],
        COLONNES_MAX[max],
        className
      )}
    >
      {children}
    </div>
  )
}
