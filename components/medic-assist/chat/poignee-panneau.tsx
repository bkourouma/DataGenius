'use client'

import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { PAS_CLAVIER_PANNEAU } from '@/lib/medic-assist/client/largeur-panneau'
import { cn } from '@/lib/utils'

export interface PoigneePanneauProps {
  largeur: number
  min: number
  max: number
  /** Nom accessible de la poignee. */
  label: string
  /** Largeur proposee (non bornee) : le parent la borne et la stocke. */
  onChange: (largeur: number) => void
  /** Fin d'un geste (relachement, touche) : moment de memoriser la largeur. */
  onValider: (largeur: number) => void
  className?: string
}

function estRtl(element: HTMLElement | null): boolean {
  const porteur = element?.closest<HTMLElement>('[dir]') ?? document.documentElement
  return porteur.getAttribute('dir') === 'rtl'
}

/**
 * Poignee de redimensionnement du panneau d'artefacts. Le panneau est a la FIN
 * du fil : en LTR il s'elargit quand on glisse vers le debut (gauche), en RTL
 * dans l'autre sens. Souris et tactile (pointer events) ; fleches gauche/droite
 * par pas de 24 px, Home/End pour le minimum et le maximum.
 */
export function PoigneePanneau({
  largeur,
  min,
  max,
  label,
  onChange,
  onValider,
  className,
}: PoigneePanneauProps) {
  const geste = useRef<{ departX: number; departLargeur: number; rtl: boolean; derniere: number } | null>(
    null,
  )

  const surAppui = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    geste.current = {
      departX: e.clientX,
      departLargeur: largeur,
      rtl: estRtl(e.currentTarget),
      derniere: largeur,
    }
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Capture indisponible : le geste continue tant que le pointeur reste dessus.
    }
  }

  const surDeplacement = (e: PointerEvent<HTMLDivElement>) => {
    const g = geste.current
    if (!g) return
    const delta = g.rtl ? e.clientX - g.departX : g.departX - e.clientX
    g.derniere = g.departLargeur + delta
    onChange(g.derniere)
  }

  const finGeste = () => {
    const g = geste.current
    if (!g) return
    geste.current = null
    onValider(g.derniere)
  }

  const surTouche = (e: KeyboardEvent<HTMLDivElement>) => {
    const rtl = estRtl(e.currentTarget)
    let suivante: number | null = null
    if (e.key === 'ArrowLeft') suivante = largeur + (rtl ? -PAS_CLAVIER_PANNEAU : PAS_CLAVIER_PANNEAU)
    else if (e.key === 'ArrowRight')
      suivante = largeur + (rtl ? PAS_CLAVIER_PANNEAU : -PAS_CLAVIER_PANNEAU)
    else if (e.key === 'Home') suivante = min
    else if (e.key === 'End') suivante = max
    if (suivante === null) return
    e.preventDefault()
    const bornee = Math.min(max, Math.max(min, suivante))
    onChange(bornee)
    onValider(bornee)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(largeur)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={surAppui}
      onPointerMove={surDeplacement}
      onPointerUp={finGeste}
      onPointerCancel={finGeste}
      onKeyDown={surTouche}
      className={cn(
        'group relative hidden w-2 shrink-0 cursor-col-resize touch-none items-stretch justify-center xl:flex',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="w-px bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary motion-reduce:transition-none"
      />
    </div>
  )
}
