'use client'

import type { ReactNode } from 'react'
import { AlertCircle, ArrowDown } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  descriptionMessageErreur,
  erreurReessayable,
  extraireCodeErreur,
  extraireDetailsErreur,
} from '@/lib/medic-assist/client/erreurs-chat'
import type { MessageUI, StatutChat } from '@/lib/medic-assist/client/types'
import { useDefilementColle } from '@/lib/medic-assist/client/use-defilement-colle'
import { useLectureVocale } from '@/lib/medic-assist/client/use-lecture-vocale'
import { IndicateurAttente } from './etape-en-cours'
import { MessageAssistant } from './message-assistant'
import { MessageUtilisateur } from './message-utilisateur'

export interface PropsFilMessages {
  messages: MessageUI[]
  statut: StatutChat
  erreur?: Error | null
  /** Arret demande par la personne : la mention « Réponse interrompue » s'affiche tout de suite. */
  arrete?: boolean
  lectureSeule?: boolean
  estAdmin: boolean
  artefactActifId?: string | null
  onReessayer: () => void
  /** Proposee quand la conversation est trop volumineuse (requete_trop_longue). */
  onNouvelleConversation?: () => void
  onRegenerer: (messageId: string) => void
  onPoserQuestion: (texte: string) => void
  onOuvrirArtefact: (artefactId: string) => void
  onActionChange?: () => void
  accueil?: ReactNode
}

/** Une partie texte non vide ou un outil : de quoi afficher quelque chose. */
function aDuContenu(message: MessageUI): boolean {
  return message.parts.some(
    (p) =>
      (p.type === 'text' && typeof p.text === 'string' && p.text.trim() !== '') ||
      (typeof p.type === 'string' && p.type.startsWith('tool-')),
  )
}

export function FilMessages({
  messages,
  statut,
  erreur,
  arrete,
  lectureSeule,
  estAdmin,
  artefactActifId,
  onReessayer,
  onNouvelleConversation,
  onRegenerer,
  onPoserQuestion,
  onOuvrirArtefact,
  onActionChange,
  accueil,
}: PropsFilMessages) {
  const t = useTranslations('medicAssist.fil')
  const tRacine = useTranslations('medicAssist')
  const locale = useLocale()
  const lecture = useLectureVocale()
  const { refConteneur, afficherAllerEnBas, allerEnBas, surDefilement } = useDefilementColle({
    dependances: [messages, statut, erreur],
    actif: messages.length > 0,
  })

  let dernierAssistantId: string | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      dernierAssistantId = messages[i].id
      break
    }
  }
  const dernier = messages[messages.length - 1]
  const codeErreur = erreur ? extraireCodeErreur(erreur) : null
  const details = erreur ? extraireDetailsErreur(erreur) : {}
  const description = codeErreur
    ? descriptionMessageErreur(codeErreur, details, locale)
    : { cle: '', valeurs: {} }

  let attente: 'reflexion' | 'redaction' | null = null
  if (statut === 'submitted') attente = 'reflexion'
  else if (statut === 'streaming') {
    if (!dernier || dernier.role !== 'assistant') attente = 'reflexion'
    else if (!aDuContenu(dernier)) attente = 'redaction'
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={refConteneur}
        onScroll={surDefilement}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t('label')}
        className="h-full overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 py-6">
          {messages.length === 0
            ? accueil
            : messages.map((message) => {
                if (message.role === 'user') return <MessageUtilisateur key={message.id} message={message} />
                if (message.role === 'assistant') {
                  return (
                    <MessageAssistant
                      key={message.id}
                      message={message}
                      estDernier={message.id === dernierAssistantId}
                      statut={statut}
                      lectureSeule={lectureSeule}
                      interrompuLocal={
                        arrete === true && message.id === dernierAssistantId && codeErreur !== 'annule'
                      }
                      estAdmin={estAdmin}
                      artefactActifId={artefactActifId}
                      lecture={lecture}
                      onRegenerer={onRegenerer}
                      onPoserQuestion={onPoserQuestion}
                      onOuvrirArtefact={onOuvrirArtefact}
                      onActionChange={onActionChange}
                    />
                  )
                }
                return null
              })}
          {attente ? <IndicateurAttente variante={attente} /> : null}
          {codeErreur === 'annule' ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('arretee')}
            </p>
          ) : codeErreur ? (
            <div
              role="alert"
              className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/40 bg-danger-soft p-3 text-sm"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t('erreur')}</p>
                <p className="text-muted-foreground">
                  {tRacine(description.cle as never, description.valeurs as never)}
                </p>
                {details.reference ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tRacine('gardeFous.reference', { reference: details.reference })}
                  </p>
                ) : null}
              </div>
              {erreurReessayable(codeErreur) ? (
                <Button type="button" variant="outline" size="sm" onClick={onReessayer}>
                  {t('reessayer')}
                </Button>
              ) : codeErreur === 'requete_trop_longue' && onNouvelleConversation ? (
                <Button type="button" variant="outline" size="sm" onClick={onNouvelleConversation}>
                  {tRacine('espace.demarrerNouvelle')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {afficherAllerEnBas ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={allerEnBas}
            className="pointer-events-auto bg-card shadow-md"
          >
            <ArrowDown aria-hidden />
            {t('allerEnBas')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
