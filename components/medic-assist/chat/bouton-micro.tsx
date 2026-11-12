"use client"

import { useEffect, useId } from 'react'
import { Mic, Square } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDictee } from '@/lib/medic-assist/client/use-dictee'

export interface BoutonMicroProps {
  /** Appele au demarrage de l'enregistrement/dictee. */
  onDebut?: () => void
  /** Texte dicte CUMULE depuis le debut de cette dictee. final=false : resultat intermediaire ; final=true : definitif. */
  onTexte: (texte: string, final: boolean) => void
  /** Appele a l'arret (manuel, silence, erreur). */
  onFin?: () => void
  desactive?: boolean
  className?: string
}

export function BoutonMicro({ onDebut, onTexte, onFin, desactive, className }: BoutonMicroProps) {
  const t = useTranslations('medicAssist')
  const idAide = useId()
  const { capacite, etat, message, serveurIndisponible, demarrer, arreter } = useDictee({ onDebut, onTexte, onFin })

  const enregistre = etat === 'ecoute'
  const occupe = etat === 'transcription'
  const indisponible = capacite === 'https' || capacite === 'indisponible'
  const motif =
    capacite === 'https'
      ? t('micro.httpsRequis')
      : capacite === 'indisponible'
        ? serveurIndisponible
          ? t('micro.transcriptionIndisponible')
          : t('micro.indisponible')
        : ''

  // Echap arrete la dictee.
  useEffect(() => {
    if (!enregistre) return
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') arreter()
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [enregistre, arreter])

  return (
    <>
      <Button
        type="button"
        variant={enregistre ? 'destructive' : 'ghost'}
        size="icon"
        aria-pressed={enregistre}
        aria-label={enregistre ? t('micro.arreter') : t('micro.dicter')}
        aria-describedby={indisponible ? idAide : undefined}
        title={indisponible ? motif : enregistre ? t('micro.arreter') : t('micro.dicter')}
        disabled={desactive || indisponible || occupe}
        onClick={() => (enregistre ? arreter() : demarrer())}
        className={cn(
          'cible-tactile max-md:min-h-11 max-md:min-w-11',
          enregistre && 'w-auto gap-2 px-3 text-xs',
          className,
        )}
      >
        {enregistre ? (
          <>
            <span className="relative flex size-2.5" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-md bg-destructive-foreground opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2.5 rounded-md bg-destructive-foreground" />
            </span>
            <Square className="size-4" aria-hidden="true" />
            <span>{t('micro.enregistrement')}</span>
          </>
        ) : (
          <Mic className="size-4" aria-hidden="true" />
        )}
      </Button>
      {indisponible ? (
        <span id={idAide} className="sr-only">
          {motif}
        </span>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
    </>
  )
}
