'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useFormState } from 'react-dom'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { chargerCatalogueMetier } from '@/lib/warehouse/catalogue-metier'
import type { DefinitionMetier } from '@/lib/warehouse/modele-metier'
import { toIntlTag } from '@/i18n/config'
import { Soumettre } from '../../formulaires'
import { publier } from './actions'

type Catalogue = NonNullable<Awaited<ReturnType<typeof chargerCatalogueMetier>>>
type Mesure = DefinitionMetier['mesures'][number]
type Filtre = NonNullable<Mesure['filtres']>[number]
// Codes d'agrégat, d'opérateur et de type de colonne -> clés de messages (sources.catalogue.*).
const agregats = ['somme', 'moyenne', 'min', 'max', 'nombre', 'nombre_distinct', 'rapport'] as const
const operateurs = ['egal', 'different'] as const
const typesConnus = ['texte', 'entier', 'decimal', 'montant', 'pourcentage', 'date', 'periode']
function useLibelleType() {
  const t = useTranslations('sources.catalogue.typesColonne')
  return (type: string) => typesConnus.includes(type) ? t(type) : type
}
const select = 'min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

function Champ({ nom, enfants }: { nom: string; enfants: ReactNode }) {
  return <label className="block min-w-0 space-y-1 text-sm font-medium"><span>{nom}</span>{enfants}</label>
}

export function FormulaireCatalogue({ catalogue }: { catalogue: Catalogue }) {
  const t = useTranslations('sources.catalogue.formulaire')
  const libelleType = useLibelleType()
  const tag = toIntlTag(useLocale())
  const mois = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(tag, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1))))
  const { jeu, definition, version, colonnes } = catalogue
  const [etat, action] = useFormState(publier.bind(null, jeu, version), {})
  const [mesures, setMesures] = useState(() => definition.mesures.map((mesure, id) => ({ id, mesure })))
  const [colonneDate, setColonneDate] = useState(definition.calendrierFiscal?.colonneDate ?? '')
  const prochainId = useRef(mesures.length)
  const metadonnees = new Map(definition.colonnes.map(c => [c.nom, c]))

  return (
    <form action={action} className="space-y-6">
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="font-semibold">{t('definitionJeu')}</h2>
        <Champ nom={t('description')} enfants={<Textarea name="description" required maxLength={300} defaultValue={definition.description} />} />
        <Champ nom={t('grain')} enfants={<Input name="grain" required maxLength={300} defaultValue={definition.grain} />} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ nom={t('responsable')} enfants={<Input name="responsable" maxLength={300} defaultValue={definition.responsable} />} />
          <Champ nom={t('noteCalendrier')} enfants={<Input name="calendrier" maxLength={300} defaultValue={definition.calendrier} />} />
          <Champ nom={t('colonneDate')} enfants={<select className={select} name="colonne-date" value={colonneDate} onChange={event => setColonneDate(event.target.value)}>
            <option value="">{t('aucunCalendrier')}</option>
            {colonnes.filter(colonne => colonne.type === 'date').map(colonne => <option key={colonne.nom} value={colonne.nom}>{colonne.description}</option>)}
            {colonneDate && !colonnes.some(colonne => colonne.type === 'date' && colonne.nom === colonneDate) && <option value={colonneDate}>{t('indisponible', { valeur: colonneDate })}</option>}
          </select>} />
          <Champ nom={t('debutExercice')} enfants={<select className={select} name="debut-exercice" disabled={!colonneDate} defaultValue={definition.calendrierFiscal?.moisDebutExercice ?? 1}>
            {mois.map((nom, index) => <option key={nom} value={index + 1}>{nom}</option>)}
          </select>} />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="font-semibold">{t('colonnes')}</h2>
        <div className="divide-y">
          {colonnes.map(({ nom, type, description }) => (
            <fieldset key={nom} className="grid gap-3 py-3 sm:grid-cols-2">
              <legend className="font-medium">{nom} <span className="text-sm font-normal text-muted-foreground">{t('typeColonne', { type: libelleType(type) })}</span></legend>
              <Champ nom={t('descriptionDe', { nom })} enfants={<Input name={'description-' + nom} maxLength={300} defaultValue={metadonnees.get(nom)?.description ?? description} />} />
              <Champ nom={t('synonymesDe', { nom })} enfants={<Input name={'synonymes-' + nom} maxLength={500} defaultValue={metadonnees.get(nom)?.synonymes.join(', ')} placeholder={t('separesVirgules')} />} />
              <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
                <label className="flex items-center gap-2"><input type="checkbox" name="cles" value={nom} defaultChecked={definition.cles.includes(nom)} aria-label={t('cleMetierPour', { nom })} />{t('cleMetier')}</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="dimensions" value={nom} defaultChecked={definition.dimensions.includes(nom)} aria-label={t('dimensionPour', { nom })} />{t('dimension')}</label>
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="font-semibold">{t('indicateurs')}</h2>
        {mesures.map(({ id, mesure }) => (
          <ChampsMesure key={id} id={id} mesure={mesure} colonnes={colonnes} retirer={() => setMesures(c => c.filter(m => m.id !== id))} />
        ))}
        <Button type="button" size="sm" variant="outline" disabled={mesures.length >= 30} onClick={() => {
          const id = prochainId.current++
          setMesures(c => [...c, { id, mesure: { cle: '', libelle: '', description: '', colonne: '', agregat: 'somme' } }])
        }}>{t('ajouterIndicateur')}</Button>
      </section>
      {etat.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
      <Soumettre texte={t('publier')} attente={t('publication')} />
    </form>
  )
}

function ChoixColonne({ colonnes, nom, valeur }: { colonnes: Catalogue['colonnes']; nom: string; valeur?: string }) {
  const t = useTranslations('sources.catalogue.formulaire')
  const libelleType = useLibelleType()
  return <select className={select} name={nom} required defaultValue={valeur ?? ''}>
    <option value="">{t('choisirColonne')}</option>
    {valeur && !colonnes.some(c => c.nom === valeur) && <option value={valeur} disabled>{t('indisponible', { valeur })}</option>}
    {colonnes.map(c => <option key={c.nom} value={c.nom}>{t('colonneAvecType', { description: c.description, type: libelleType(c.type) })}</option>)}
  </select>
}

function ChampsMesure({ id, mesure, colonnes, retirer }: {
  id: number; mesure: Mesure; colonnes: Catalogue['colonnes']; retirer: () => void
}) {
  const t = useTranslations('sources.catalogue.formulaire')
  const tAgregats = useTranslations('sources.catalogue.agregats')
  const tOperateurs = useTranslations('sources.catalogue.operateurs')
  const [agregat, setAgregat] = useState(mesure.agregat)
  const [filtres, setFiltres] = useState(() => (mesure.filtres ?? []).map((filtre, id) => ({ filtre, id })))
  const prochainId = useRef(filtres.length)
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 font-medium">{mesure.libelle || t('nouvelIndicateur')}</legend>
      <input type="hidden" name="mesures" value={id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Champ nom={t('cleIndicateur')} enfants={<Input name={`cle-${id}`} required pattern="[a-z][a-z0-9_]{0,62}" title={t('cleTitre')} placeholder={t('cleExemple')} defaultValue={mesure.cle} />} />
        <Champ nom={t('libelle')} enfants={<Input name={`libelle-${id}`} required maxLength={300} defaultValue={mesure.libelle} />} />
        <div className="sm:col-span-2"><Champ nom={t('definition')} enfants={<Textarea name={`definition-${id}`} required maxLength={300} defaultValue={mesure.description} />} /></div>
        <Champ nom={t('calcul')} enfants={<select className={select} name={`agregat-${id}`} value={agregat} onChange={e => setAgregat(e.target.value as Mesure['agregat'])}>
          {agregats.map(cle => <option key={cle} value={cle}>{tAgregats(cle)}</option>)}
        </select>} />
        <Champ nom={agregat === 'rapport' ? t('numerateur') : t('colonneACalculer')} enfants={<ChoixColonne colonnes={colonnes} nom={`colonne-${id}`} valeur={mesure.colonne} />} />
        {agregat === 'rapport' && <Champ nom={t('denominateur')} enfants={<ChoixColonne colonnes={colonnes} nom={`denominateur-${id}`} valeur={mesure.denominateur} />} />}
        <Champ nom={t('unite')} enfants={<Input name={`unite-${id}`} maxLength={300} defaultValue={mesure.unite} />} />
        <Champ nom={t('devise')} enfants={<Input name={`devise-${id}`} pattern="[A-Za-z]{3}" maxLength={3} placeholder="XOF" defaultValue={mesure.devise} />} />
      </div>
      {filtres.map(({ id: filtreId, filtre }) => (
        <div key={filtreId} className="grid items-end gap-2 border-t pt-3 sm:grid-cols-4">
          <input type="hidden" name={`filtres-${id}`} value={filtreId} />
          <Champ nom={t('colonneFiltre')} enfants={<ChoixColonne colonnes={colonnes} nom={`colonne-filtre-${id}-${filtreId}`} valeur={filtre.colonne} />} />
          <Champ nom={t('condition')} enfants={<select className={select} name={`operateur-filtre-${id}-${filtreId}`} defaultValue={filtre.operateur}>
            {operateurs.map(code => <option key={code} value={code}>{tOperateurs(code)}</option>)}
          </select>} />
          <Champ nom={t('valeur')} enfants={<Input name={`valeur-filtre-${id}-${filtreId}`} maxLength={300} defaultValue={filtre.valeur} />} />
          <Button type="button" size="sm" variant="ghost" onClick={() => setFiltres(c => c.filter(f => f.id !== filtreId))}>{t('retirerFiltre')}</Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={filtres.length >= 6} onClick={() => {
          const id = prochainId.current++
          const filtre: Filtre = { colonne: '', operateur: 'egal', valeur: '' }
          setFiltres(c => [...c, { id, filtre }])
        }}>{t('ajouterFiltre')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={retirer}>{t('retirerIndicateur')}</Button>
      </div>
    </fieldset>
  )
}
