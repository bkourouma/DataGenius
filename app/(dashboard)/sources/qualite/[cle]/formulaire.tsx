'use client'

import { useState } from 'react'
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

export function FormulaireQualite({ jeu }: { jeu: Jeu }) {
  const [definition, setDefinition] = useState<DefinitionQualite>(jeu.definition)
  const [etat, action] = useFormState(enregistrer.bind(null, jeu.cle, jeu.version), {})
  const option = (c: Jeu['colonnes'][number]) => <option key={c.nom} value={c.nom}>{c.description} ({c.type})</option>
  const textes = jeu.colonnes.filter(c => ['texte', 'periode'].includes(c.type))
  const comparables = jeu.colonnes.filter(c => ['entier', 'decimal', 'montant', 'pourcentage', 'date'].includes(c.type))
  const options = jeu.colonnes.map(option)
  const { filtres, normalisations, controles } = definition
  const colonneInitiale = jeu.colonnes[0]?.nom ?? ''

  return <form action={action} className="space-y-5 rounded-lg border bg-card p-5">
    <input type="hidden" name="definition" value={JSON.stringify(definition)} />
    <fieldset className="space-y-3">
      <legend className="font-semibold">Normaliser les valeurs</legend>
      {normalisations.map((n, i) => {
        const changer = (valeur: typeof n) => setDefinition({ ...definition, normalisations: modifier(normalisations, i, valeur) })
        return <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]" key={i}>
          <select aria-label={`Colonne à normaliser ${i + 1}`} className={select} value={n.colonne} onChange={e => changer({ ...n, colonne: e.target.value })}>{textes.map(option)}</select>
          <select aria-label={`Normalisation ${i + 1}`} className={select} value={n.operation} onChange={e => changer({ ...n, operation: e.target.value as typeof n.operation })}>
            <option value="espaces">Retirer les espaces aux extrémités</option><option value="minuscules">Mettre en minuscules</option>
            <option value="majuscules">Mettre en majuscules</option><option value="vide_en_null">Traiter le texte vide comme une valeur nulle</option>
          </select>
          <Button type="button" variant="ghost" onClick={() => setDefinition({ ...definition, normalisations: normalisations.filter((_, j) => j !== i) })}>Retirer</Button>
        </div>
      })}
      <Button type="button" variant="outline" disabled={!textes.length || normalisations.length >= 20} onClick={() => {
        const colonne = textes[0]
        if (colonne) setDefinition({ ...definition, normalisations: [...normalisations, { colonne: colonne.nom, operation: 'espaces' }] })
      }}>Ajouter une normalisation</Button>
    </fieldset>
    <fieldset className="space-y-3">
      <legend className="font-semibold">Filtrer les lignes</legend>
      {filtres.map((f, i) => {
        const changer = (valeur: typeof f) => setDefinition({ ...definition, filtres: modifier(filtres, i, valeur) })
        return <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]" key={i}>
          <select aria-label={`Colonne du filtre ${i + 1}`} className={select} value={f.colonne} onChange={e => changer({ ...f, colonne: e.target.value })}>{options}</select>
          <select aria-label={`Comparaison du filtre ${i + 1}`} className={select} value={f.operateur} onChange={e => {
            const operateur = e.target.value as typeof f.operateur
            changer({ colonne: f.colonne, operateur, ...(operateur === 'non_nul' ? {} : { valeur: f.valeur ?? '' }) })
          }}><option value="egal">Est égal à</option><option value="different">Est différent de</option><option value="non_nul">Est renseigné</option></select>
          {f.operateur !== 'non_nul' && <Input aria-label={`Valeur du filtre ${i + 1}`} value={f.valeur ?? ''} onChange={e => changer({ ...f, valeur: e.target.value })} />}
          <Button type="button" variant="ghost" onClick={() => setDefinition({ ...definition, filtres: filtres.filter((_, j) => j !== i) })}>Retirer</Button>
        </div>
      })}
      <Button type="button" variant="outline" disabled={!colonneInitiale || filtres.length >= 20} onClick={() => setDefinition({ ...definition, filtres: [...filtres, { colonne: colonneInitiale, operateur: 'non_nul' }] })}>Ajouter un filtre</Button>
    </fieldset>
    <fieldset className="space-y-3">
      <legend className="font-semibold">Contrôles de publication</legend>
      {controles.map((c, i) => {
        const changer = (valeur: typeof c) => setDefinition({ ...definition, controles: modifier(controles, i, valeur) })
        return <div className="space-y-2 rounded-md border p-3" key={i}>
          <select aria-label={`Type du contrôle ${i + 1}`} className={select} value={c.type} onChange={e => {
            const type = e.target.value as typeof c.type
            const colonne = comparables.find(col => c.colonnes.includes(col.nom)) ?? comparables[0]
            changer({ type, colonnes: type === 'plage' && colonne ? [colonne.nom] : c.colonnes })
          }}><option value="non_nul">Valeurs renseignées</option><option value="unique">Clé unique</option><option value="plage" disabled={!comparables.length}>Plage de valeurs</option></select>
          {c.type === 'plage' ? <div className="grid gap-2 sm:grid-cols-3">
            <select className={select} aria-label={`Colonne du contrôle ${i + 1}`} value={c.colonnes[0]} onChange={e => changer({ ...c, colonnes: [e.target.value] })}>{comparables.map(option)}</select>
            <Input aria-label={`Minimum du contrôle ${i + 1}`} placeholder="Minimum" value={c.min ?? ''} onChange={e => changer({ ...c, min: e.target.value || undefined })} />
            <Input aria-label={`Maximum du contrôle ${i + 1}`} placeholder="Maximum" value={c.max ?? ''} onChange={e => changer({ ...c, max: e.target.value || undefined })} />
          </div> : <div role="group" aria-label={`Colonnes du contrôle ${i + 1}`} className="flex flex-wrap gap-3">
            {jeu.colonnes.map(col => <label key={col.nom} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.colonnes.includes(col.nom)} disabled={c.colonnes.length >= 8 && !c.colonnes.includes(col.nom)} onChange={e => changer({ ...c, colonnes: e.target.checked ? [...c.colonnes, col.nom] : c.colonnes.filter(nom => nom !== col.nom) })} />{col.description}</label>)}
          </div>}
          <Button type="button" variant="ghost" onClick={() => setDefinition({ ...definition, controles: controles.filter((_, j) => j !== i) })}>Retirer le contrôle</Button>
        </div>
      })}
      <Button type="button" variant="outline" disabled={!colonneInitiale || controles.length >= 20} onClick={() => setDefinition({ ...definition, controles: [...controles, { type: 'non_nul', colonnes: [colonneInitiale] }] })}>Ajouter un contrôle</Button>
    </fieldset>
    {etat?.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
    <Soumettre texte="Enregistrer les règles" attente="Enregistrement…" />
  </form>
}

export function RelancerImport({ cle }: { cle: string }) {
  const [etat, action] = useFormState(relancer.bind(null, cle), {})
  return <form action={action} className="space-y-2">
    {etat?.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
    <Soumettre texte="Relancer la synchronisation" attente="Synchronisation…" variant="outline" />
  </form>
}
