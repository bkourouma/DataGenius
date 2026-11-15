'use client'

import { useTranslations } from 'next-intl'
import { useFormState } from 'react-dom'
import { Retour, Soumettre } from '../../../sources/formulaires'
import { restaurer } from '../../actions'

/** Formulaire de restauration : à placer dans un bloc de confirmation (details). */
export function RestaurerVersion({ id, version, versionCourante }: { id: string; version: number; versionCourante: number }) {
  const t = useTranslations('historique')
  const [etat, action] = useFormState(restaurer, {})
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="versionCourante" value={versionCourante} />
      <p className="text-sm text-muted-foreground">{t('explicationRestauration', { n: version })}</p>
      <Retour {...etat} />
      <Soumettre texte={t('restaurerNom', { n: version })} attente={t('restaurationEnCours')} />
    </form>
  )
}
