'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { chargerTableau, optionsTableau } from '@/lib/warehouse/tableaux'
import type { DefinitionTableau } from '@/lib/warehouse/tableaux-modeles'
import { Soumettre } from '../sources/formulaires'
import { enregistrer } from './actions'

type Tuile = DefinitionTableau['tuiles'][number]
type Tableau = Awaited<ReturnType<typeof chargerTableau>>
const selection = 'block min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm'

export function FormulaireTableau({ tableau, options, comptes, analyses }: {
  tableau: Tableau
  options: Awaited<ReturnType<typeof optionsTableau>>
  comptes: { id: string; nom: string; email: string }[]
  analyses: { id: string; titre: string }[]
}) {
  const [tuiles, setTuiles] = useState(tableau?.definition.tuiles ?? [])
  const [lecteurs, setLecteurs] = useState(tableau?.definition.lecteurs ?? [])
  const [etat, action] = useFormState(enregistrer.bind(null, tableau ? { id: tableau.id, version: tableau.version } : null), {})

  function modifier(tuile: Tuile) {
    setTuiles(courantes => courantes.map(courante => courante.id === tuile.id ? tuile : courante))
  }

  function ajouter(type: Tuile['type']) {
    const id = crypto.randomUUID()
    const tuile: Tuile = type === 'artefact' ? { id, type, artefact: '' } : { id, type, jeu: '', mesure: '', dimensions: [] }
    setTuiles(courantes => [...courantes, tuile])
  }

  return <form action={action} className="space-y-5">
    <input type="hidden" name="configuration" value={JSON.stringify({ tuiles, lecteurs })} />
    <label className="block space-y-1 text-sm font-medium">Nom du tableau
      <Input name="titre" required maxLength={120} defaultValue={tableau?.definition.titre} />
    </label>
    <section className="space-y-4" aria-labelledby="tuiles-titre">
      <h2 id="tuiles-titre" className="text-lg font-semibold">Tuiles</h2>
      {tuiles.map((tuile, index) => {
        const jeu = tuile.type === 'mesure' ? options.find(o => o.cle === tuile.jeu) : undefined
        return <fieldset key={tuile.id} className="space-y-3 rounded-lg border bg-card p-4">
          <legend className="px-1 font-medium">{tuile.type === 'mesure' ? 'Indicateur' : 'Artefact'} {index + 1}</legend>
          {tuile.type === 'artefact' ? <>
            {analyses.length > 0 && <label className="block space-y-1 text-sm">Choisir dans Mes analyses
              <select className={selection} value={analyses.some(a => a.id === tuile.artefact) ? tuile.artefact : ''}
                onChange={event => modifier({ ...tuile, artefact: event.target.value })}>
                <option value="">Sélectionner une analyse</option>
                {analyses.map(a => <option key={a.id} value={a.id}>{a.titre}</option>)}
              </select>
            </label>}
            <label className="block space-y-1 text-sm">Identifiant ou lien de l’analyse
              <Input required maxLength={300} value={tuile.artefact}
                onChange={event => {
                  const texte = event.target.value.trim()
                  const lien = /\/analyses\/([^/?#]+)\/?(?:[?#].*)?$/.exec(texte)
                  modifier({ ...tuile, artefact: lien?.[1] ?? texte })
                }} />
            </label>
          </> : <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">Jeu de données
                <select required className={selection} value={tuile.jeu}
                  onChange={event => modifier({ ...tuile, jeu: event.target.value, mesure: '', dimensions: [] })}>
                  <option value="">Choisir un jeu</option>
                  {tuile.jeu && !jeu && <option value={tuile.jeu}>Jeu indisponible</option>}
                  {options.map(o => <option key={o.cle} value={o.cle}>{o.libelle}</option>)}
                </select>
              </label>
              <label className="block space-y-1 text-sm">Mesure
                <select required className={selection} value={tuile.mesure}
                  onChange={event => modifier({ ...tuile, mesure: event.target.value })}>
                  <option value="">Choisir une mesure</option>
                  {tuile.mesure && !jeu?.mesures.some(m => m.cle === tuile.mesure) && <option value={tuile.mesure}>Mesure indisponible</option>}
                  {jeu?.mesures.map(m => <option key={m.cle} value={m.cle}>{m.libelle}</option>)}
                </select>
              </label>
            </div>
            {Boolean(jeu?.dimensions.length) && <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Dimensions de détail (3 maximum)</legend>
              <div className="flex flex-wrap gap-3">{jeu?.dimensions.map(d => {
                const selectionnee = tuile.dimensions.includes(d.cle)
                return <label key={d.cle} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={selectionnee} disabled={!selectionnee && tuile.dimensions.length >= 3}
                    onChange={event => modifier({ ...tuile, dimensions: event.target.checked ? [...tuile.dimensions, d.cle] : tuile.dimensions.filter(c => c !== d.cle) })} />
                  {d.libelle}
                </label>
              })}</div>
            </fieldset>}
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1 text-sm">Objectif (facultatif)
                <Input inputMode="decimal" value={tuile.objectif ?? ''} onChange={event => modifier({ ...tuile, objectif: event.target.value.replace(',', '.') || undefined })} />
              </label>
              <label className="block space-y-1 text-sm">Alerte
                <select className={selection} value={tuile.alerte?.sens ?? ''} onChange={event => {
                  const sens = event.target.value
                  modifier({ ...tuile, alerte: sens === 'au_dessus' || sens === 'au_dessous' ? { sens, seuil: tuile.alerte?.seuil ?? '' } : undefined })
                }}>
                  <option value="">Désactivée</option><option value="au_dessus">Au seuil ou au-dessus</option><option value="au_dessous">Au seuil ou en dessous</option>
                </select>
              </label>
              {tuile.alerte && <label className="block space-y-1 text-sm">Seuil
                <Input inputMode="decimal" required value={tuile.alerte.seuil} onChange={event => {
                  if (tuile.alerte) modifier({ ...tuile, alerte: { ...tuile.alerte, seuil: event.target.value.replace(',', '.') } })
                }} />
              </label>}
            </div>
          </>}
          <Button type="button" variant="outline" size="sm" onClick={() => setTuiles(courantes => courantes.filter(t => t.id !== tuile.id))}>Retirer la tuile</Button>
        </fieldset>
      })}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!options.length || tuiles.length >= 12} onClick={() => ajouter('mesure')}>Ajouter un indicateur</Button>
        <Button type="button" variant="outline" disabled={tuiles.length >= 12} onClick={() => ajouter('artefact')}>Ajouter un artefact</Button>
      </div>
      {!options.length && <p className="text-sm text-muted-foreground">Aucun indicateur publié dans vos jeux accessibles.</p>}
    </section>
    {(comptes.length > 0 || lecteurs.length > 0) && <fieldset className="space-y-2 rounded-lg border bg-card p-4">
      <legend className="px-1 font-medium">Partager avec des lecteurs</legend>
      <p className="text-sm text-muted-foreground">Chaque lecteur conserve ses droits d’accès aux données et aux artefacts.</p>
      <div className="grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">
        {[...comptes, ...lecteurs.filter(id => !comptes.some(c => c.id === id)).map(id => ({ id, nom: 'Compte indisponible', email: '' }))].map(compte => {
          const coche = lecteurs.includes(compte.id)
          return <label key={compte.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={coche} disabled={!coche && lecteurs.length >= 30}
              onChange={event => setLecteurs(actuels => event.target.checked ? [...actuels, compte.id] : actuels.filter(id => id !== compte.id))} />
            {compte.nom || compte.email}
          </label>
        })}
      </div>
    </fieldset>}
    {etat.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
    <Soumettre texte="Enregistrer le tableau" attente="Enregistrement…" />
  </form>
}
