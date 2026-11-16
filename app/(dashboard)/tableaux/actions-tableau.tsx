'use client'

import { useId } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useFormState } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Retour, Soumettre } from '../sources/formulaires'
import { dupliquer, supprimer } from './actions'

export function ActionsTableau({ id, titre }: { id: string; titre: string }) {
  const idCase = useId()
  const t = useTranslations('tableaux.boutons')
  const th = useTranslations('historique')
  const [etatDup, actionDup] = useFormState(dupliquer, {})
  const [etatSup, actionSup] = useFormState(supprimer, {})
  return (
    <div className="flex flex-wrap items-start gap-3">
      <form action={actionDup} className="space-y-1">
        <input type="hidden" name="id" value={id} />
        <Soumettre texte={t('dupliquer')} attente={t('duplication')} variant="outline" />
        <Retour {...etatDup} />
      </form>
      <Button asChild variant="outline" size="sm"><Link href={`/tableaux/${id}/historique`}>{th('lien')}</Link></Button>
      <details className="rounded-md border p-2">
        <summary className="cursor-pointer text-sm" aria-label={t('supprimerNom', { titre })}>{t('supprimer')}</summary>
        <form action={actionSup} className="mt-2 space-y-2">
          <input type="hidden" name="id" value={id} />
          <label htmlFor={idCase} className="flex items-start gap-2 text-sm">
            <input id={idCase} type="checkbox" name="confirmation" required className="mt-0.5 size-4 shrink-0 accent-primary" />
            <span>{t('confirmer')}</span>
          </label>
          <Retour {...etatSup} />
          <Soumettre texte={t('supprimerTableau')} attente={t('suppression')} variant="destructive" />
        </form>
      </details>
    </div>
  )
}
