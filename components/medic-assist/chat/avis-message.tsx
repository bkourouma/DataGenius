'use client'

import { useId, useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { envoyerAvis } from '@/lib/medic-assist/client/api'
import type { ValeurAvis } from '@/lib/medic-assist/client/types'
import { cn } from '@/lib/utils'

const CLASSE_BOUTON =
  'cible-tactile inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50'

/** Lit l'avis deja donne, s'il figure dans les metadonnees du message. */
export function avisInitial(metadata: unknown): ValeurAvis | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const avis = (metadata as { avis?: unknown }).avis
  // Le contrat dit 'positif' | 'negatif' | null ; 1 / -1 est accepte si le serveur renvoie la valeur numerique.
  if (avis === 'positif' || avis === 1) return 'positif'
  if (avis === 'negatif' || avis === -1) return 'negatif'
  return null
}

export function AvisMessage({
  messageId,
  initial = null,
}: {
  messageId: string
  initial?: ValeurAvis | null
}) {
  const t = useTranslations('medicAssist.message')
  const [avis, setAvis] = useState<ValeurAvis | null>(initial)
  const [formulaire, setFormulaire] = useState(false)
  const [commentaire, setCommentaire] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const idTitre = useId()

  async function envoyer(valeur: ValeurAvis, texte?: string) {
    const precedent = avis
    setEnvoi(true)
    setAvis(valeur)
    try {
      if (texte) await envoyerAvis(messageId, valeur, texte)
      else await envoyerAvis(messageId, valeur)
      setFormulaire(false)
      setCommentaire('')
      toast.success(t('avisEnvoye'))
    } catch {
      setAvis(precedent)
      toast.error(t('erreurAvis'))
    } finally {
      setEnvoi(false)
    }
  }

  const positif = avis === 'positif' && !formulaire
  const negatif = formulaire || avis === 'negatif'

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-pressed={positif}
          aria-label={t('utile')}
          title={t('utile')}
          disabled={envoi}
          onClick={() => {
            if (avis === 'positif' && !formulaire) return
            setFormulaire(false)
            void envoyer('positif')
          }}
          className={cn(CLASSE_BOUTON, positif && 'bg-accent text-foreground')}
        >
          <ThumbsUp className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-pressed={negatif}
          aria-label={t('pasUtile')}
          title={t('pasUtile')}
          disabled={envoi}
          onClick={() => {
            if (avis === 'negatif' || formulaire) return
            setFormulaire(true)
          }}
          className={cn(CLASSE_BOUTON, negatif && 'bg-accent text-foreground')}
        >
          <ThumbsDown className="size-4" aria-hidden />
        </button>
      </div>
      {formulaire ? (
        <form
          className="mt-2 w-full max-w-md space-y-2 rounded-lg border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void envoyer('negatif', commentaire.trim() || undefined)
          }}
        >
          <label id={idTitre} htmlFor={`${idTitre}-champ`} className="block text-sm font-medium">
            {t('commentaireTitre')}
          </label>
          <textarea
            id={`${idTitre}-champ`}
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            placeholder={t('commentairePlaceholder')}
            rows={3}
            maxLength={1000}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={envoi}
              onClick={() => void envoyer('negatif')}
            >
              {t('commentaireIgnorer')}
            </Button>
            <Button type="submit" size="sm" disabled={envoi}>
              {t('commentaireEnvoyer')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
