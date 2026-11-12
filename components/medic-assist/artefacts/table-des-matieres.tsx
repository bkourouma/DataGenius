'use client'

/**
 * Table des matières d'un document : liens vers les titres h2/h3.
 *
 * Grand écran : toujours visible, collée en haut de sa colonne (le parent la place et la
 * fait coller). Mobile : repliée au-dessus du texte, un bouton l'ouvre. Clavier : Tab
 * parcourt les liens, flèches haut/bas aussi, Début/Fin vont aux extrémités ; Entrée
 * amène au titre et lui donne le focus. Les retraits utilisent des marges logiques (RTL).
 */

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ListTree } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { TitreDocument } from '@/lib/medic-assist/artefacts/document-outline'

export interface TableDesMatieresProps {
  titres: Pick<TitreDocument, 'id' | 'texte' | 'niveau'>[]
  className?: string
  /**
   * Colonne latérale (conteneur large) : liste toujours visible, sans bouton de repli.
   * Par défaut (étroit) : repliée au-dessus du texte, un bouton l'ouvre.
   */
  large?: boolean
}

export function TableDesMatieres({ titres, className, large = false }: TableDesMatieresProps) {
  const t = useTranslations('medicAssistArtefacts.document.tableDesMatieres')
  const idListe = useId()
  const [ouverte, setOuverte] = useState(false)
  const listeRef = useRef<HTMLOListElement>(null)

  if (titres.length === 0) return null

  const aller = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const cible = document.getElementById(id)
    if (!cible) return
    event.preventDefault()
    cible.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    cible.focus({ preventScroll: true })
    try {
      window.history.replaceState(null, '', `#${encodeURIComponent(id)}`)
    } catch {
      // Contexte sans historique (aperçu, test) : le défilement suffit.
    }
  }

  const deplacer = (event: React.KeyboardEvent<HTMLOListElement>) => {
    const liens = Array.from(listeRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])
    if (liens.length === 0) return
    const courant = liens.indexOf(document.activeElement as HTMLAnchorElement)
    let suivant = -1
    if (event.key === 'ArrowDown') suivant = Math.min(courant + 1, liens.length - 1)
    else if (event.key === 'ArrowUp') suivant = Math.max(courant - 1, 0)
    else if (event.key === 'Home') suivant = 0
    else if (event.key === 'End') suivant = liens.length - 1
    if (suivant < 0) return
    event.preventDefault()
    liens[suivant].focus()
  }

  return (
    <nav aria-label={t('region')} className={cn('rounded-lg border bg-card text-sm', className)}>
      {!large && (
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-start font-semibold focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={ouverte}
        aria-controls={idListe}
        onClick={() => setOuverte(v => !v)}
      >
        <ListTree className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1">{ouverte ? t('replier') : t('ouvrir')}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', ouverte && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      )}
      {large && <p className="px-3 pt-3 text-xs font-semibold text-muted-foreground">{t('titre')}</p>}
      <ol
        id={idListe}
        ref={listeRef}
        onKeyDown={deplacer}
        className={cn('m-0 list-none flex-col gap-0.5 p-2', large || ouverte ? 'flex' : 'hidden')}
      >
        {titres.map(titre => (
          <li key={titre.id}>
            <a
              href={`#${titre.id}`}
              dir="auto"
              aria-label={t('aller', { titre: titre.texte })}
              onClick={event => aller(event, titre.id)}
              className={cn(
                'flex items-center rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                large ? 'min-h-8' : 'min-h-11',
                titre.niveau === 3 && 'ms-4 text-[0.8125rem]'
              )}
            >
              <span className="line-clamp-2">{titre.texte}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
