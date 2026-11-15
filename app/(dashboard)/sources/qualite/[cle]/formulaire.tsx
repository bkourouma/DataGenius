'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useFormState } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { chargerQualite } from '@/lib/warehouse/qualite-admin'
import type { DefinitionQualite } from '@/lib/warehouse/qualite'
import { Soumettre } from '../../formulaires'
import { enregistrer, relancer } from './actions'

type Jeu = NonNullable<Awaited<ReturnType<typeof chargerQualite>>>
const select = 'min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm'

function modifier<T>(liste: T[], index: number, valeur: T) {
  return liste.map((item, i) => i === index ? valeur : item)
}

/** Type de colonne de l'entrepôt -> clé `sources.qualite.formulaire.types.<clé>`. */
const TYPES_COLONNE = ['texte', 'periode', 'entier', 'decimal', 'montant', 'pourcentage', 'date']

export function FormulaireQualite({ jeu }: { jeu: Jeu }) {
  const t = useTranslations('sources.qualite.formulaire')
  const [definition, setDefinition] = useState<DefinitionQualite>(jeu.definition)
  const [etat, action] = useFormState(enregistrer.bind(null, jeu.cle, jeu.version), {})
  const libelleType = (type: string) => TYPES_COLONNE.includes(type) ? t('types.' + type) : type
  const option = (c: Jeu['colonnes'][number]) => <option key={c.nom} value={c.nom}>{t('colonneOption', { description: c.description, type: libelleType(c.type) })}</option>
  const textes = jeu.colonnes.filter(c => ['texte', 'periode'].includes(c.type))
  const comparables = jeu.colonnes.filter(c => ['entier', 'decimal', 'montant', 'pourcentage', 'date'].includes(c.type))
  const options = jeu.colonnes.map(option)
  const { filtres, normalisations, controles } = definition
  const colonneInitiale = jeu.colonnes[0]?.nom ?? ''

  return <form action={action} className="space-y-5 rounded-lg border bg-card p-5">
    <input type="hidden" name="definition" value={JSON.stringify(definition)} />
    <fieldset className="space-y-3">
      <legend className="font-semibold">{t('normaliser')}</legend>
      {normalisations.map((n, i) => {
        const changer = (valeur: typeof n) => setDefinition({ ...definition, normalisations: modifier(normalisations, i, valeur) })
        return <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]" key={i}>
          <select aria-label={t('colonneNormaliserAria', { n: i + 1 })} className={select} value={n.colonne} onChange={e => changer({ ...n, colonne: e.target.value })}>{textes.map(option)}</select>
          <select aria-label={t('normalisationAria', { n: i + 1 })} className={select} value={n.operation} onChange={e => changer({ ...n, operation: e.target.value as typeof n.operation })}>
            <option value="espaces">{t('operations.espaces')}</option><option value="minuscules">{t('operations.minuscules')}</option>
            <option value="majuscules">{t('operations.majuscules')}</option><option value="vide_en_null">{t('operations.videEnNull')}</option>
          </select>
          <Button type="button" variant="ghost" onClick={() => setDefinition({ ...definition, normalisations: normalisations.filter((_, j) => j !== i) })}>{t('retirer')}</Button>
        </div>
      })}
      <Button type="button" variant="outline" disabled={!textes.length || normalisations.length >= 20} onClick={() => {
        const colonne = textes[0]
        if (colonne) setDefinition({ ...definition, normalisations: [...normalisations, { colonne: colonne.nom, operation: 'espaces' }] })
      }}>{t('ajouterNormalisation')}</Button>
    </fieldset>
    <fieldset className="space-y-3">
      <legend className="font-semibold">{t('filtrer')}</legend>
      {filtres.map((f, i) => {
        const changer = (valeur: typeof f) => setDefinition({ ...definition, filtres: modifier(filtres, i, valeur) })
        return <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]" key={i}>
          <select aria-label={t('colonneFiltreAria', { n: i + 1 })} className={select} value={f.colonne} onChange={e => changer({ ...f, colonne: e.target.value })}>{options}</select>
          <select aria-label={t('comparaisonAria', { n: i + 1 })} className={select} value={f.operateur} onChange={e => {
            const operateur = e.target.value as typeof f.operateur
            changer({ colonne: f.colonne, operateur, ...(operateur === 'non_nul' ? {} : { valeur: f.valeur ?? '' }) })
          }}><option value="egal">{t('operateurs.egal')}</option><option value="different">{t('operateurs.different')}</option><option value="non_nul">{t('operateurs.nonNul')}</option></select>
          {f.operateur !== 'non_nul' && <Input aria-label={t('valeurFiltreAria', { n: i + 1 })} value={f.valeur ?? ''} onChange={e => changer({ ...f, valeur: e.target.value })} />}
          <Button type="button" variant="ghost" onClick={() => setDefinition({ ...definition, filtres: filtres.filter((_, j) => j !== i) })}>{t('retirer')}</Button>
        </div>
      })}
      <Button type="button" variant="outline" disabled={!colonneInitiale || filtres.length >= 20} onClick={() => setDefinition({ ...definition, filtres: [...filtres, { colonne: colonneInitiale, operateur: 'non_nul' }] })}>{t('ajouterFiltre')}</Button>
    </fieldset>
    <fieldset className="space-y-3">
      <legend className="font-semibold">{t('controles')}</legend>
      {controles.map((c, i) => {
        const changer = (valeur: typeof c) => setDefinition({ ...definition, controles: modifier(controles, i, valeur) })
        return <div className="space-y-2 rounded-md border p-3" key={i}>
          <select aria-label={t('typeControleAria', { n: i + 1 })} className={select} value={c.type} onChange={e => {
            const type = e.target.value as typeof c.type
            const colonne = comparables.find(col => c.colonnes.includes(col.nom)) ?? comparables[0]
            changer({ type, colonnes: type === 'plage' && colonne ? [colonne.nom] : c.colonnes })
          }}><option value="non_nul">{t('typesControle.nonNul')}</option><option value="unique">{t('typesControle.unique')}</option><option value="plage" disabled={!comparables.length}>{t('typesControle.plage')}</option></select>
          {c.type === 'plage' ? <div className="grid gap-2 sm:grid-cols-3">
            <select className={select} aria-label={t('colonneControleAria', { n: i + 1 })} value={c.colonnes[0]} onChange={e => changer({ ...c, colonnes: [e.target.value] })}>{comparables.map(option)}</select>
            <Input aria-label={t('minimumAria', { n: i + 1 })} placeholder={t('minimum')} value={c.min ?? ''} onChange={e => changer({ ...c, min: e.target.value || undefined })} />
            <Input aria-label={t('maximumAria', { n: i + 1 })} placeholder={t('maximum')} value={c.max ?? ''} onChange={e => changer({ ...c, max: e.target.value || undefined })} />
          </div> : <div role="group" aria-label={t('colonnesControleAria', { n: i + 1 })} className="flex flex-wrap gap-3">
            {jeu.colonnes.map(col => <label key={col.nom} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.colonnes.includes(col.nom)} disabled={c.colonnes.length >= 8 && !c.colonnes.includes(col.nom)} onChange={e => changer({ ...c, colonnes: e.target.checked ? [...c.colonnes, col.nom] : c.colonnes.filter(nom => nom !== col.nom) })} />{col.description}</label>)}
          </div>}
          <Button type="button" variant="ghost" onClick={() => setDefinition({ ...definition, controles: controles.filter((_, j) => j !== i) })}>{t('retirerControle')}</Button>
        </div>
      })}
      <Button type="button" variant="outline" disabled={!colonneInitiale || controles.length >= 20} onClick={() => setDefinition({ ...definition, controles: [...controles, { type: 'non_nul', colonnes: [colonneInitiale] }] })}>{t('ajouterControle')}</Button>
    </fieldset>
    {etat?.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
    <Soumettre texte={t('enregistrer')} attente={t('enregistrement')} />
  </form>
}

export function RelancerImport({ cle }: { cle: string }) {
  const t = useTranslations('sources.qualite.formulaire')
  const [etat, action] = useFormState(relancer.bind(null, cle), {})
  return <form action={action} className="space-y-2">
    {etat?.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
    <Soumettre texte={t('relancer')} attente={t('synchronisation')} variant="outline" />
  </form>
}
