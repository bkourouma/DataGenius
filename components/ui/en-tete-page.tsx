import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * En-tete commun des pages : retour eventuel, titre, une phrase qui dit a quoi
 * sert la page, et l'action principale a droite. Une seule action primaire par
 * page ; les autres passent en `outline` ou en lien.
 */
export function EnTetePage({
  titre,
  description,
  actions,
  retour,
  className,
}: {
  titre: ReactNode
  description?: ReactNode
  actions?: ReactNode
  retour?: { href: string; libelle: string }
  className?: string
}) {
  return (
    <header className={cn('space-y-3 pb-1', className)}>
      {retour && (
        <Link
          href={retour.href}
          className="-ms-1 inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          {retour.libelle}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-2xl space-y-1">
          <h1 className="text-balance text-2xl font-semibold">{titre}</h1>
          {description && <p className="text-pretty text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

/**
 * Etat vide qui enseigne : ce que contiendra l'espace, pourquoi il est vide,
 * et le geste suivant.
 */
export function EtatVide({
  icone,
  titre,
  children,
  action,
  className,
}: {
  icone: ReactNode
  titre: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center rounded-lg border border-dashed bg-card px-6 py-10 text-center', className)}>
      <span className="mb-3 flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-5" aria-hidden>
        {icone}
      </span>
      <p className="font-semibold">{titre}</p>
      {children && <p className="mt-1 max-w-sm text-pretty text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
