'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { signOut } from 'next-auth/react'
import { Database, LogOut, Menu, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { entreeActive, groupesNavigation, initiales, type GroupeNavigation } from './navigation'
import { PaletteCommandes } from './palette-commandes'
import { useRaccourciPalette } from './raccourci'

export interface CoquilleProps {
  estAdmin: boolean
  /** Tableaux de bord accessibles, proposes par la palette. */
  tableaux?: { id: string; titre: string }[]
  nom?: string | null
  courriel?: string | null
  children: ReactNode
}

function Marque({ className }: { className?: string }) {
  return (
    <Link href="/assistant" className={cn('flex items-center gap-2.5 font-semibold tracking-tight', className)}>
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Database className="size-4" aria-hidden />
      </span>
      Data Genius
    </Link>
  )
}

function Rail({
  groupes,
  nom,
  courriel,
  estAdmin,
  onRechercher,
  onNaviguer,
}: {
  groupes: GroupeNavigation[]
  nom?: string | null
  courriel?: string | null
  estAdmin: boolean
  onRechercher: () => void
  onNaviguer?: () => void
}) {
  const chemin = usePathname()
  const actif = entreeActive(chemin, groupes)
  const raccourci = useRaccourciPalette()

  return (
    <div className="flex h-full flex-col text-shell-foreground">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Marque className="text-base text-white" />
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onRechercher}
          aria-label="Rechercher ou demander"
          title="Rechercher ou demander"
          className="flex h-9 w-full items-center gap-2 rounded-md border border-shell-line bg-white/[0.04] px-2.5 text-sm text-shell-muted transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-shell-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate text-start">Rechercher</span>
          <kbd className="rounded-sm border border-shell-line px-1 font-mono text-2xs">{raccourci}</kbd>
        </button>
      </div>

      <nav aria-label="Espace de travail" className="flex-1 overflow-y-auto px-3 py-2">
        {groupes.map((groupe) => (
          <div key={groupe.id} className="mb-5 last:mb-0">
            {groupes.length > 1 && (
              <p className="px-2.5 pb-1.5 text-xs font-medium text-shell-muted">{groupe.libelle}</p>
            )}
            <ul className="space-y-0.5">
              {groupe.entrees.map(({ href, libelle, icone: Icone }) => {
                const estActif = href === actif
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNaviguer}
                      aria-current={estActif ? 'page' : undefined}
                      className={cn(
                        'cible-tactile flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300',
                        estActif
                          ? 'bg-white/[0.11] font-medium text-white'
                          : 'text-shell-muted hover:bg-white/[0.05] hover:text-shell-foreground',
                      )}
                    >
                      <Icone className={cn('size-4 shrink-0', estActif && 'text-blue-300')} aria-hidden />
                      {libelle}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-2.5 border-t border-shell-line px-3 py-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white"
        >
          {initiales(nom || courriel)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-white">{nom || courriel || 'Compte'}</p>
          <p className="truncate text-xs text-shell-muted">{estAdmin ? 'Administrateur' : 'Membre'}</p>
        </div>
        <button
          type="button"
          aria-label="Se déconnecter"
          title="Se déconnecter"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="cible-tactile flex size-8 items-center justify-center rounded-md text-shell-muted transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
        </button>
      </div>
    </div>
  )
}

/**
 * Coquille de l'espace de travail.
 *
 * Bureau (>= 1024 px) : rail fixe de 15 rem a gauche, la page occupe le reste
 * et toute la hauteur. En dessous : barre haute de 3,5 rem (menu, marque,
 * recherche) et le rail dans un tiroir. Ctrl K / ⌘K ouvre la palette partout.
 */
export function Coquille({ estAdmin, nom, courriel, tableaux = [], children }: CoquilleProps) {
  const groupes = useMemo(() => groupesNavigation(estAdmin), [estAdmin])
  const [paletteOuverte, setPaletteOuverte] = useState(false)
  const [tiroirOuvert, setTiroirOuvert] = useState(false)
  const chemin = usePathname()

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOuverte((o) => !o)
      }
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [])

  // Une navigation (lien, retour) referme le tiroir.
  useEffect(() => setTiroirOuvert(false), [chemin])

  const rechercher = useCallback(() => {
    setTiroirOuvert(false)
    setPaletteOuverte(true)
  }, [])

  return (
    <>
      <aside className="rib-wall fixed inset-y-0 start-0 z-30 hidden w-60 border-e border-shell-line lg:block">
        <Rail groupes={groupes} nom={nom} courriel={courriel} estAdmin={estAdmin} onRechercher={rechercher} />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-2 lg:hidden">
        <DialogPrimitive.Root open={tiroirOuvert} onOpenChange={setTiroirOuvert}>
          <DialogPrimitive.Trigger
            aria-label="Ouvrir le menu"
            className="cible-tactile flex size-10 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Menu className="size-5" aria-hidden />
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
            <DialogPrimitive.Content
              aria-describedby={undefined}
              className="rib-wall fixed inset-y-0 start-0 z-50 w-[min(17rem,85vw)] shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-left motion-reduce:animate-none rtl:data-[state=open]:slide-in-from-right"
            >
              <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="Fermer le menu"
                className="absolute end-2 top-2 flex size-10 items-center justify-center rounded-md text-shell-muted hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              >
                <X className="size-5" aria-hidden />
              </DialogPrimitive.Close>
              <Rail
                groupes={groupes}
                nom={nom}
                courriel={courriel}
                estAdmin={estAdmin}
                onRechercher={rechercher}
                onNaviguer={() => setTiroirOuvert(false)}
              />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
        <Marque className="text-base" />
        <button
          type="button"
          onClick={rechercher}
          aria-label="Rechercher ou demander"
          className="cible-tactile ms-auto flex size-10 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="size-5" aria-hidden />
        </button>
      </header>

      <div className="lg:ps-60">
        <main className="mx-auto max-w-[1800px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main>
      </div>

      <PaletteCommandes ouverte={paletteOuverte} onOuverteChange={setPaletteOuverte} groupes={groupes} tableaux={tableaux} />
    </>
  )
}
