"use client"

import { FileText, Loader2, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

export interface PuceFichier {
  cle: string
  nom: string
  taille?: number
  enCours: boolean
}

export interface PucesPiecesJointesProps {
  pieces: PuceFichier[]
  onRetirer: (cle: string) => void
}

export function PucesPiecesJointes({ pieces, onRetirer }: PucesPiecesJointesProps) {
  const t = useTranslations('medicAssist')
  const format = useFormatter()
  if (pieces.length === 0) return null

  const tailleLisible = (octets: number) =>
    octets >= 1024 * 1024
      ? format.number(octets / (1024 * 1024), {
          style: 'unit',
          unit: 'megabyte',
          maximumFractionDigits: 1,
        })
      : format.number(Math.max(1, Math.round(octets / 1024)), {
          style: 'unit',
          unit: 'kilobyte',
        })

  return (
    <ul className="flex flex-wrap gap-2" aria-label={t('saisie.joindre')}>
      {pieces.map((piece) => (
        <li
          key={piece.cle}
          className="flex max-w-full items-center gap-1.5 rounded-md border bg-secondary px-2 py-1 text-xs text-secondary-foreground"
        >
          {piece.enCours ? (
            <Loader2
              className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <FileText className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="max-w-[10rem] truncate" title={piece.nom}>
            {piece.nom}
          </span>
          {piece.enCours ? (
            <span className="sr-only">{t('saisie.televersement', { nom: piece.nom })}</span>
          ) : piece.taille !== undefined ? (
            <span className="text-muted-foreground" data-figure>
              {tailleLisible(piece.taille)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onRetirer(piece.cle)}
            aria-label={t('saisie.retirerPiece', { nom: piece.nom })}
            className="cible-tactile -me-1 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-md:size-8"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  )
}
