'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, RefreshCw, Square, Volume2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { markdownVersTexte } from '@/lib/medic-assist/client/texte-brut'
import type { LectureVocale } from '@/lib/medic-assist/client/use-lecture-vocale'
import type { ValeurAvis } from '@/lib/medic-assist/client/types'
import { cn } from '@/lib/utils'
import { AvisMessage } from './avis-message'

const CLASSE_BOUTON =
  'cible-tactile inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'

/**
 * Barre d'actions sous une reponse : Copier, Regenerer, avis, lecture vocale.
 * En lecture seule, seuls Copier et la lecture vocale restent.
 */
export function ActionsMessage({
  messageId,
  markdown,
  estDernier,
  generationEnCours,
  lectureSeule,
  avisInitial,
  lecture,
  onRegenerer,
}: {
  messageId: string
  markdown: string
  estDernier: boolean
  generationEnCours: boolean
  lectureSeule?: boolean
  avisInitial?: ValeurAvis | null
  lecture: LectureVocale
  onRegenerer: (messageId: string) => void
}) {
  const t = useTranslations('medicAssist.message')
  const [copie, setCopie] = useState(false)
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (minuterie.current) clearTimeout(minuterie.current)
    },
    [],
  )

  async function copier() {
    try {
      await navigator.clipboard.writeText(markdownVersTexte(markdown))
      setCopie(true)
      if (minuterie.current) clearTimeout(minuterie.current)
      minuterie.current = setTimeout(() => setCopie(false), 2000)
    } catch {
      toast.error(t('erreurCopie'))
    }
  }

  const enLecture = lecture.lecturEnCoursId === messageId
  const libelleLecture = !lecture.disponible
    ? t('lectureIndisponible')
    : enLecture
      ? t('arretLecture')
      : t('lire')

  return (
    <div role="group" aria-label={t('actions')} className="mt-2 flex flex-wrap items-start gap-0.5">
      <button
        type="button"
        onClick={() => void copier()}
        aria-label={copie ? t('copie') : t('copier')}
        title={copie ? t('copie') : t('copier')}
        className={CLASSE_BOUTON}
      >
        {copie ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
      {copie ? (
        <span role="status" className="me-1 text-xs text-muted-foreground">
          {t('copie')}
        </span>
      ) : null}
      {!lectureSeule && estDernier ? (
        <button
          type="button"
          onClick={() => onRegenerer(messageId)}
          disabled={generationEnCours}
          aria-label={t('regenerer')}
          title={t('regenerer')}
          className={CLASSE_BOUTON}
        >
          <RefreshCw className="size-4" aria-hidden />
        </button>
      ) : null}
      {!lectureSeule ? <AvisMessage messageId={messageId} initial={avisInitial ?? null} /> : null}
      <button
        type="button"
        onClick={() => (enLecture ? lecture.arreter() : lecture.lire(messageId, markdownVersTexte(markdown)))}
        disabled={!lecture.disponible}
        aria-label={libelleLecture}
        title={libelleLecture}
        className={cn(CLASSE_BOUTON, enLecture && 'bg-accent text-foreground')}
      >
        {enLecture ? <Square className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
      </button>
    </div>
  )
}
