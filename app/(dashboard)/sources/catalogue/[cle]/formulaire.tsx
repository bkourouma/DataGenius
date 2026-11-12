'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useFormState } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { chargerCatalogueMetier } from '@/lib/warehouse/catalogue-metier'
import type { DefinitionMetier } from '@/lib/warehouse/modele-metier'
import { Soumettre } from '../../formulaires'
import { publier } from './actions'

type Catalogue = NonNullable<Awaited<ReturnType<typeof chargerCatalogueMetier>>>
type Mesure = DefinitionMetier['mesures'][number]
type Filtre = NonNullable<Mesure['filtres']>[number]
const agregats = {
  somme: 'Somme', moyenne: 'Moyenne', min: 'Minimum', max: 'Maximum',
  nombre: 'Nombre de valeurs', nombre_distinct: 'Nombre de valeurs distinctes', rapport: 'Rapport de deux sommes',
}
const select = 'min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

function Champ({ nom, enfants }: { nom: string; enfants: ReactNode }) {
  return <label className="block min-w-0 space-y-1 text-sm font-medium"><span>{nom}</span>{enfants}</label>
}

export function FormulaireCatalogue({ catalogue }: { catalogue: Catalogue }) {
  const { jeu, definition, version, colonnes } = catalogue
  const [etat, action] = useFormState(publier.bind(null, jeu, version), {})
  const [mesures, setMesures] = useState(() => definition.mesures.map((mesure, id) => ({ id, mesure })))
  const prochainId = useRef(mesures.length)
  const metadonnees = new Map(definition.colonnes.map(c => [c.nom, c]))

  return (
    <form action={action} className="space-y-6">
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="font-semibold">Définition du jeu</h2>
        <Champ nom="Description" enfants={<Textarea name="description" required maxLength={300} defaultValue={definition.description} />} />
        <Champ nom="Ce que représente une ligne" enfants={<Input name="grain" required maxLength={300} defaultValue={definition.grain} />} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ nom="Responsable" enfants={<Input name="responsable" maxLength={300} defaultValue={definition.responsable} />} />
          <Champ nom="Calendrier" enfants={<Input name="calendrier" maxLength={300} defaultValue={definition.calendrier} />} />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="font-semibold">Colonnes</h2>
        <div className="divide-y">
          {colonnes.map(({ nom, type, description }) => (
            <fieldset key={nom} className="grid gap-3 py-3 sm:grid-cols-2">
              <legend className="font-medium">{nom} <span className="text-sm font-normal text-muted-foreground">({type})</span></legend>
              <Champ nom={'Description de ' + nom} enfants={<Input name={'description-' + nom} maxLength={300} defaultValue={metadonnees.get(nom)?.description ?? description} />} />
              <Champ nom={'Synonymes de ' + nom} enfants={<Input name={'synonymes-' + nom} maxLength={500} defaultValue={metadonnees.get(nom)?.synonymes.join(', ')} placeholder="Séparés par des virgules" />} />
              <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
                <label className="flex items-center gap-2"><input type="checkbox" name="cles" value={nom} defaultChecked={definition.cles.includes(nom)} aria-label={'Clé métier · ' + nom} />Clé métier</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="dimensions" value={nom} defaultChecked={definition.dimensions.includes(nom)} aria-label={'Dimension · ' + nom} />Dimension</label>
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="font-semibold">Indicateurs</h2>
        {mesures.map(({ id, mesure }) => (
          <ChampsMesure key={id} id={id} mesure={mesure} colonnes={colonnes} retirer={() => setMesures(c => c.filter(m => m.id !== id))} />
        ))}
        <Button type="button" size="sm" variant="outline" disabled={mesures.length >= 30} onClick={() => {
          const id = prochainId.current++
          setMesures(c => [...c, { id, mesure: { cle: '', libelle: '', description: '', colonne: '', agregat: 'somme' } }])
        }}>Ajouter un indicateur</Button>
      </section>
      {etat.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
      <Soumettre texte="Publier la définition" attente="Publication…" />
    </form>
  )
}

function ChoixColonne({ colonnes, nom, valeur }: { colonnes: Catalogue['colonnes']; nom: string; valeur?: string }) {
  return <select className={select} name={nom} required defaultValue={valeur ?? ''}>
    <option value="">Choisir une colonne</option>
    {valeur && !colonnes.some(c => c.nom === valeur) && <option value={valeur} disabled>{valeur} (indisponible)</option>}
    {colonnes.map(c => <option key={c.nom} value={c.nom}>{c.description} ({c.type})</option>)}
  </select>
}

function ChampsMesure({ id, mesure, colonnes, retirer }: {
  id: number; mesure: Mesure; colonnes: Catalogue['colonnes']; retirer: () => void
}) {
  const [agregat, setAgregat] = useState(mesure.agregat)
  const [filtres, setFiltres] = useState(() => (mesure.filtres ?? []).map((filtre, id) => ({ filtre, id })))
  const prochainId = useRef(filtres.length)
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 font-medium">{mesure.libelle || 'Nouvel indicateur'}</legend>
      <input type="hidden" name="mesures" value={id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Champ nom="Clé de l’indicateur" enfants={<Input name={`cle-${id}`} required pattern="[a-z][a-z0-9_]{0,62}" title="Minuscules sans espaces, chiffres et caractères de soulignement" placeholder="ex. total_net" defaultValue={mesure.cle} />} />
        <Champ nom="Libellé" enfants={<Input name={`libelle-${id}`} required maxLength={300} defaultValue={mesure.libelle} />} />
        <div className="sm:col-span-2"><Champ nom="Définition" enfants={<Textarea name={`definition-${id}`} required maxLength={300} defaultValue={mesure.description} />} /></div>
        <Champ nom="Calcul" enfants={<select className={select} name={`agregat-${id}`} value={agregat} onChange={e => setAgregat(e.target.value as Mesure['agregat'])}>
          {Object.entries(agregats).map(([cle, libelle]) => <option key={cle} value={cle}>{libelle}</option>)}
        </select>} />
        <Champ nom={agregat === 'rapport' ? 'Numérateur' : 'Colonne à calculer'} enfants={<ChoixColonne colonnes={colonnes} nom={`colonne-${id}`} valeur={mesure.colonne} />} />
        {agregat === 'rapport' && <Champ nom="Dénominateur" enfants={<ChoixColonne colonnes={colonnes} nom={`denominateur-${id}`} valeur={mesure.denominateur} />} />}
        <Champ nom="Unité" enfants={<Input name={`unite-${id}`} maxLength={300} defaultValue={mesure.unite} />} />
        <Champ nom="Devise" enfants={<Input name={`devise-${id}`} pattern="[A-Za-z]{3}" maxLength={3} placeholder="XOF" defaultValue={mesure.devise} />} />
      </div>
      {filtres.map(({ id: filtreId, filtre }) => (
        <div key={filtreId} className="grid items-end gap-2 border-t pt-3 sm:grid-cols-4">
          <input type="hidden" name={`filtres-${id}`} value={filtreId} />
          <Champ nom="Colonne du filtre" enfants={<ChoixColonne colonnes={colonnes} nom={`colonne-filtre-${id}-${filtreId}`} valeur={filtre.colonne} />} />
          <Champ nom="Condition" enfants={<select className={select} name={`operateur-filtre-${id}-${filtreId}`} defaultValue={filtre.operateur}>
            <option value="egal">Égale à</option><option value="different">Différente de</option>
          </select>} />
          <Champ nom="Valeur" enfants={<Input name={`valeur-filtre-${id}-${filtreId}`} maxLength={300} defaultValue={filtre.valeur} />} />
          <Button type="button" size="sm" variant="ghost" onClick={() => setFiltres(c => c.filter(f => f.id !== filtreId))}>Retirer le filtre</Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={filtres.length >= 6} onClick={() => {
          const id = prochainId.current++
          const filtre: Filtre = { colonne: '', operateur: 'egal', valeur: '' }
          setFiltres(c => [...c, { id, filtre }])
        }}>Ajouter un filtre</Button>
        <Button type="button" size="sm" variant="ghost" onClick={retirer}>Retirer l’indicateur</Button>
      </div>
    </fieldset>
  )
}
