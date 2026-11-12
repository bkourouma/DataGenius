import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Icone posee dans le champ, du cote du debut de ligne. */
  icon?: React.ReactNode
  /** Contenu pose a la fin du champ : unite, bouton d'affichage, compteur. */
  trailing?: React.ReactNode
}

/**
 * Champ de saisie.
 *
 * L'etat d'erreur se pilote par `aria-invalid`, que `FormControl` pose seul :
 * la bordure rouge et l'anneau de focus suivent donc l'accessibilite au lieu de
 * dependre d'une classe passee a la main, qu'il etait facile d'oublier.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, icon, trailing, ...props }, ref) => {
    const field = (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background transition-colors [@media(pointer:coarse)]:min-h-11",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
          "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
          icon && "ps-10",
          trailing && "pe-10",
          className
        )}
        ref={ref}
        {...props}
      />
    )

    if (!icon && !trailing) return field

    return (
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute start-3 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
            {icon}
          </span>
        )}
        {field}
        {trailing && (
          <span className="absolute end-2 top-1/2 flex -translate-y-1/2 items-center text-muted-foreground">
            {trailing}
          </span>
        )}
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input }
