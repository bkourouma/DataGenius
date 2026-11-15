'use client'

import { useFormState } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { chargerIncremental } from '@/lib/warehouse/incremental-admin'
import { Soumettre } from '../../formulaires'
import { enregistrer, relancer } from './actions'

type Jeu = NonNullable<Awaited<ReturnType<typeof chargerIncremental>>>

export function FormulaireIncremental({ jeu }: { jeu: Jeu }) {
  const t = useTranslations('sources.incremental.formulaire')
  const definition = jeu.etat?.definition
  const [etat, action] = useFormState(enregistrer.bind(null, jeu.cle, jeu.etat?.version ?? 0), {})
  const [execution, lancer] = useFormState(relancer.bind(null, jeu.cle), {})
  return <>
    <form action={action} className="space-y-5 rounded-lg border bg-card p-5">
      <fieldset className="space-y-2">
        <legend className="font-semibold">{t('cleStable')}</legend>
        <p className="text-sm text-muted-foreground">{t('cleDescription')}</p>
        {jeu.colonnes.filter(c => ['texte', 'entier', 'date'].includes(c.type)).map(c =>
          <label key={c.nom} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="cles" value={c.nom} defaultChecked={definition?.cles.includes(c.nom)} />
            {c.description}
          </label>)}
      </fieldset>
      <label className="block space-y-2 text-sm font-medium">
        <span>{t('colonneHorodatage')}</span>
        <select name="dateModification" defaultValue={definition?.dateModification ?? ''} required
          className="min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">{t('choisirColonne')}</option>
          {jeu.colonnes.map(c => <option key={c.nom} value={c.nom}>{c.description}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-medium">
          <span>{t('chevauchement')}</span>
          <Input name="chevauchementMinutes" type="number" min={0} max={1440} required
            defaultValue={definition?.chevauchementMinutes ?? 5} />
        </label>
        <label className="space-y-2 text-sm font-medium">
          <span>{t('reconciliation')}</span>
          <Input name="reconciliationMinutes" type="number" min={1} max={43200} required
            defaultValue={definition?.reconciliationMinutes ?? 1440} />
        </label>
      </div>
      {etat?.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Soumettre texte={definition ? t('enregistrerConfig') : t('activer')} attente={t('enregistrement')} />
        {definition && <Button name="mode" value="desactiver" formNoValidate variant="outline">{t('desactiver')}</Button>}
      </div>
    </form>
    {definition && <form action={lancer} className="flex flex-wrap items-center gap-2">
      <Button name="mode" value="synchroniser" variant="outline">{t('synchroniserMaintenant')}</Button>
      <Button name="mode" value="reconcilier" variant="outline">{t('reconcilier')}</Button>
      {execution?.erreur && <p role="alert" className="text-sm text-destructive">{execution.erreur}</p>}
    </form>}
  </>
}
