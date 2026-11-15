'use client'

import { useId } from 'react'
import { useFormState } from 'react-dom'
import { Retour, Soumettre } from '../sources/formulaires'
import { dupliquer, supprimer } from './actions'

export function ActionsTableau({ id, titre }: { id: string; titre: string }) {
  const idCase = useId()
  const [etatDup, actionDup] = useFormState(dupliquer, {})
  const [etatSup, actionSup] = useFormState(supprimer, {})
  return (
    <div className="flex flex-wrap items-start gap-3">
      <form action={actionDup} className="space-y-1">
        <input type="hidden" name="id" value={id} />
        <Soumettre texte="Dupliquer" attente="Duplication…" variant="outline" />
        <Retour {...etatDup} />
      </form>
      <details className="rounded-md border p-2">
        <summary className="cursor-pointer text-sm">Supprimer<span className="sr-only"> {titre}</span></summary>
        <form action={actionSup} className="mt-2 space-y-2">
          <input type="hidden" name="id" value={id} />
          <label htmlFor={idCase} className="flex items-start gap-2 text-sm">
            <input id={idCase} type="checkbox" name="confirmation" required className="mt-0.5 size-4 shrink-0 accent-primary" />
            <span>Je confirme la suppression définitive de ce tableau</span>
          </label>
          <Retour {...etatSup} />
          <Soumettre texte="Supprimer le tableau" attente="Suppression…" variant="destructive" />
        </form>
      </details>
    </div>
  )
}
