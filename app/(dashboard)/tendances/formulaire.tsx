'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const champ = 'min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm'

export function FormulaireTendances({ options, selection }: {
  options: { cle: string; titre: string; mesures: { cle: string; libelle: string }[] }[]
  selection: { jeu?: string; mesure?: string; debut: string; fin: string; horizon: string }
}) {
  const t = useTranslations('ecrans.tendances')
  const [jeu, setJeu] = useState(selection.jeu ?? '')
  const [mesure, setMesure] = useState(selection.mesure ?? '')
  const mesures = options.find(option => option.cle === jeu)?.mesures ?? []
  return (
    <form method="get" className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="block space-y-1 text-sm">{t('jeu')}
        <select name="jeu" required className={champ} value={jeu} onChange={event => {
          setJeu(event.target.value)
          setMesure('')
        }}>
          <option value="">{t('choisirJeu')}</option>
          {options.map(option => <option key={option.cle} value={option.cle}>{option.titre}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">{t('indicateur')}
        <select name="mesure" required disabled={!jeu} className={champ} value={mesure} onChange={event => setMesure(event.target.value)}>
          <option value="">{t('choisirIndicateur')}</option>
          {mesures.map(option => <option key={option.cle} value={option.cle}>{option.libelle}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">{t('premierMois')}
        <Input name="debut" type="month" required defaultValue={selection.debut} />
      </label>
      <label className="block space-y-1 text-sm">{t('dernierMois')}
        <Input name="fin" type="month" required defaultValue={selection.fin} />
      </label>
      <label className="block space-y-1 text-sm">{t('horizon')}
        <Input name="horizon" type="number" min={1} max={6} step={1} required defaultValue={selection.horizon} />
      </label>
      <Button className="self-end justify-self-start" disabled={!mesure}>{t('analyser')}</Button>
    </form>
  )
}
