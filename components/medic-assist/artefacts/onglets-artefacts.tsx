'use client'

import { BarChart3, FileText, Gauge, Table2, type LucideIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, type KeyboardEvent } from 'react'

import { getDirection } from '@/i18n/config'
import type { TypeArtefact } from '@/lib/medic-assist/contrats'
import { cn } from '@/lib/utils'

import type { ResumeArtefact } from './use-artefacts-conversation'

const ICONES: Record<TypeArtefact, LucideIcon> = {
  tableau: Table2,
  graphique: BarChart3,
  indicateurs: Gauge,
  document: FileText,
}

/** Icône d'un type d'artefact (décorative : le type est toujours dit en texte à côté). */
export function IconeTypeArtefact({
  type,
  className,
}: {
  type: TypeArtefact
  className?: string
}) {
  const Icone = ICONES[type] ?? FileText
  return <Icone aria-hidden className={cn('size-4 shrink-0', className)} />
}

export function idOnglet(artefactId: string): string {
  return `onglet-artefact-${artefactId}`
}

export const ID_ZONE_ARTEFACT = 'zone-artefact-actif'

interface OngletsArtefactsProps {
  artefacts: ResumeArtefact[]
  actifId: string | null
  onSelection: (artefactId: string) => void
  /** Nom accessible de la liste d'onglets. */
  libelle: string
}

/**
 * Onglets des artefacts de la conversation : défilement horizontal, titre tronqué avec
 * info-bulle, flèches (inversées en arabe), Début et Fin. La sélection suit le focus.
 */
export function OngletsArtefacts({
  artefacts,
  actifId,
  onSelection,
  libelle,
}: OngletsArtefactsProps) {
  const locale = useLocale()
  const tTypes = useTranslations('medicAssistArtefacts');
  const rtl = getDirection(locale) === 'rtl'
  const listeRef = useRef<HTMLDivElement>(null)

  const aller = (index: number) => {
    const cible = artefacts[index]
    if (!cible) return
    onSelection(cible.id)
    const bouton = document.getElementById(idOnglet(cible.id))
    bouton?.focus()
    bouton?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  const surTouche = (evenement: KeyboardEvent<HTMLDivElement>) => {
    const courant = artefacts.findIndex(a => a.id === actifId)
    const suivant = rtl ? 'ArrowLeft' : 'ArrowRight'
    const precedent = rtl ? 'ArrowRight' : 'ArrowLeft'
    let cible = -1
    if (evenement.key === suivant) cible = (courant + 1) % artefacts.length
    else if (evenement.key === precedent) cible = (courant - 1 + artefacts.length) % artefacts.length
    else if (evenement.key === 'Home') cible = 0
    else if (evenement.key === 'End') cible = artefacts.length - 1
    if (cible < 0) return
    evenement.preventDefault()
    aller(cible)
  }

  return (
    <div
      ref={listeRef}
      role="tablist"
      aria-label={libelle}
      aria-orientation="horizontal"
      onKeyDown={surTouche}
      className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
    >
      {artefacts.map(artefact => {
        const actif = artefact.id === actifId
        return (
          <button
            key={artefact.id}
            id={idOnglet(artefact.id)}
            type="button"
            role="tab"
            aria-selected={actif}
            aria-controls={ID_ZONE_ARTEFACT}
            tabIndex={actif ? 0 : -1}
            title={artefact.titre}
            aria-label={`${artefact.titre} (${tTypes(`panneau.types.${artefact.type}`)})`}
            onClick={() => onSelection(artefact.id)}
            className={cn(
              'flex h-9 max-w-[9rem] sm:max-w-[12rem] shrink-0 items-center gap-2 rounded-md border px-3 text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              '[@media(pointer:coarse)]:min-h-11',
              actif
                ? 'border-border bg-card font-semibold text-foreground shadow-sm'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <IconeTypeArtefact type={artefact.type} />
            <span className="truncate">{artefact.titre}</span>
          </button>
        )
      })}
    </div>
  )
}
