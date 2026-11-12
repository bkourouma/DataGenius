"use client"

import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export interface ZoneDepotProps {
  onFichiers: (fichiers: File[]) => void
  desactive?: boolean
  children: ReactNode
  className?: string
}

function contientDesFichiers(e: DragEvent): boolean {
  const types = e.dataTransfer?.types
  return !!types && Array.from(types as ArrayLike<string>).includes('Files')
}

export function ZoneDepot({ onFichiers, desactive, children, className }: ZoneDepotProps) {
  const t = useTranslations('medicAssist')
  const [actif, setActif] = useState(false)
  // Compteur d'entrees/sorties : evite le clignotement quand le curseur passe sur un enfant.
  const compteur = useRef(0)

  const surEntree = (e: DragEvent) => {
    if (desactive || !contientDesFichiers(e)) return
    e.preventDefault()
    compteur.current += 1
    setActif(true)
  }
  const surSurvol = (e: DragEvent) => {
    if (desactive || !contientDesFichiers(e)) return
    e.preventDefault()
  }
  const surSortie = (e: DragEvent) => {
    if (desactive || !contientDesFichiers(e)) return
    compteur.current = Math.max(0, compteur.current - 1)
    if (compteur.current === 0) setActif(false)
  }
  const surDepot = (e: DragEvent) => {
    if (desactive || !contientDesFichiers(e)) return
    e.preventDefault()
    compteur.current = 0
    setActif(false)
    const fichiers = Array.from(e.dataTransfer.files ?? [])
    if (fichiers.length > 0) onFichiers(fichiers)
  }

  return (
    <div
      className={cn('relative', className)}
      onDragEnter={surEntree}
      onDragOver={surSurvol}
      onDragLeave={surSortie}
      onDrop={surDepot}
    >
      {children}
      {actif ? (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-background/90 text-sm font-semibold text-primary"
        >
          <Upload className="size-6" aria-hidden="true" />
          <span>{t('saisie.deposer')}</span>
        </div>
      ) : null}
    </div>
  )
}
