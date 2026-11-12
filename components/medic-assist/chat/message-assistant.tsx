'use client'

import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { texteDuMessage } from '@/lib/medic-assist/client/texte-brut'
import type { MessageUI, StatutChat } from '@/lib/medic-assist/client/types'
import type { LectureVocale } from '@/lib/medic-assist/client/use-lecture-vocale'
import { cn } from '@/lib/utils'
import { ActionsMessage } from './actions-message'
import { avisInitial } from './avis-message'
import { PartiesMessage } from './parties-message'

export function MessageAssistant({
  message,
  estDernier,
  interrompuLocal,
  statut,
  lectureSeule,
  estAdmin,
  artefactActifId,
  lecture,
  onRegenerer,
  onPoserQuestion,
  onOuvrirArtefact,
  onActionChange,
}: {
  message: MessageUI
  /** Dernier message assistant du fil. */
  estDernier: boolean
  /** Arret demande localement : le serveur n'a pas encore pose metadata.interrompu. */
  interrompuLocal?: boolean
  statut: StatutChat
  lectureSeule?: boolean
  estAdmin: boolean
  artefactActifId?: string | null
  lecture: LectureVocale
  onRegenerer: (messageId: string) => void
  onPoserQuestion: (texte: string) => void
  onOuvrirArtefact: (artefactId: string) => void
  onActionChange?: () => void
}) {
  const t = useTranslations('medicAssist.fil')
  const texte = texteDuMessage(message)
  const generationEnCours = statut === 'submitted' || statut === 'streaming'
  // La barre n'apparait pas tant que la reponse s'ecrit.
  const interrompu =
    interrompuLocal === true ||
    (message.metadata as { interrompu?: unknown } | null | undefined)?.interrompu === true
  const afficherBarre = texte.trim() !== '' && !(estDernier && generationEnCours)

  return (
    <article className="group/message">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" aria-hidden />
        <span>{t('assistant')}</span>
      </div>
      <PartiesMessage
        message={message}
        estDernierAssistant={estDernier}
        statut={statut}
        lectureSeule={lectureSeule}
        estAdmin={estAdmin}
        artefactActifId={artefactActifId}
        onOuvrirArtefact={onOuvrirArtefact}
        onPoserQuestion={onPoserQuestion}
        onActionChange={onActionChange}
      />
      {interrompu ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {t('arretee')}
        </p>
      ) : null}
      {afficherBarre ? (
        <div
          className={cn(
            !estDernier &&
              'opacity-0 transition-opacity focus-within:opacity-100 group-hover/message:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100',
          )}
        >
          <ActionsMessage
            messageId={message.id}
            markdown={texte}
            estDernier={estDernier}
            generationEnCours={generationEnCours}
            lectureSeule={lectureSeule}
            avisInitial={avisInitial(message.metadata)}
            lecture={lecture}
            onRegenerer={onRegenerer}
          />
        </div>
      ) : null}
    </article>
  )
}
