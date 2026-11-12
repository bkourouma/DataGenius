'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useId } from 'react'

import type { VersionArtefact } from '@/lib/medic-assist/artefacts/types-rendu'
import { cn } from '@/lib/utils'

interface SelecteurVersionProps {
  versions: VersionArtefact[]
  /** Version actuellement affichée. */
  versionAffichee: number
  /** Appelé avec le numéro choisi. */
  onChoisir: (version: number) => void
  className?: string
}

/**
 * Liste des versions d'un artefact (v1, v2… avec date locale, la dernière marquée
 * « actuelle »). Absent s'il n'y a qu'une version.
 */
export function SelecteurVersion({
  versions,
  versionAffichee,
  onChoisir,
  className,
}: SelecteurVersionProps) {
  const t = useTranslations('medicAssistArtefacts')
  const format = useFormatter()
  const id = useId()

  if (versions.length <= 1) return null

  const triees = [...versions].sort((a, b) => b.version - a.version)
  const derniere = triees[0].version

  const date = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : format.dateTime(d, { dateStyle: 'short', timeStyle: 'short' })
  }

  return (
    <div className={cn('flex min-w-0 max-w-full items-center gap-2', className)}>
      <label htmlFor={id} className="sr-only">
        {t('panneau.version.etiquette')}
      </label>
      <select
        id={id}
        value={versionAffichee}
        onChange={evenement => onChoisir(Number(evenement.target.value))}
        className="h-9 min-w-0 max-w-full rounded-md border border-input bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [@media(pointer:coarse)]:min-h-11"
      >
        {triees.map(v => {
          const quand = date(v.creeLe)
          const base = quand
            ? t('panneau.version.libelleDate', { n: v.version, date: quand })
            : t('panneau.version.libelle', { n: v.version })
          return (
            <option key={v.version} value={v.version}>
              {v.version === derniere ? `${base} (${t('panneau.version.actuelle')})` : base}
            </option>
          )
        })}
      </select>
    </div>
  )
}
