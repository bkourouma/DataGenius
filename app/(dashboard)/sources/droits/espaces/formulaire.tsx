'use client'

import { useId } from 'react'
import { useFormState } from 'react-dom'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Soumettre } from '../../formulaires'
import { sauvegarderEspace } from './actions'

export function FormulaireEspace({ espace, groupes, jeux }: {
  espace?: { id: string; version: number; nom: string; description: string; groupes: string[]; jeux: string[] }
  groupes: { id: string; nom: string }[]
  jeux: { cle: string; titre: string; occupe: boolean }[]
}) {
  const idForm = useId()
  const [etat, action] = useFormState(sauvegarderEspace, {})
  return <form action={action} className="space-y-4">
    <input type="hidden" name="id" value={espace?.id ?? ''} />
    <input type="hidden" name="version" value={espace?.version ?? 0} />
    <div className="grid gap-2"><Label htmlFor={`${idForm}-nom`}>Nom de l’espace</Label><Input id={`${idForm}-nom`} name="nom" defaultValue={espace?.nom} maxLength={100} required /></div>
    <div className="grid gap-2"><Label htmlFor={`${idForm}-description`}>Description (facultative)</Label><Textarea id={`${idForm}-description`} name="description" defaultValue={espace?.description} maxLength={300} rows={2} /></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Groupes autorisés</legend>
        <p className="text-sm text-muted-foreground">Sans groupe sélectionné, l’espace est réservé aux administrateurs.</p>
        {groupes.length === 0 && <p className="text-sm text-muted-foreground">Aucun groupe d’accès n’existe encore.</p>}
        <div className="max-h-56 space-y-1 overflow-auto">
          {groupes.map(groupe => <label key={groupe.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="groupes" value={groupe.id} defaultChecked={espace?.groupes.includes(groupe.id)} />{groupe.nom}
          </label>)}
        </div>
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Jeux de données</legend>
        {jeux.length === 0 && <p className="text-sm text-muted-foreground">Aucun jeu de données disponible.</p>}
        <div className="max-h-56 space-y-1 overflow-auto">
          {jeux.map(jeu => <label key={jeu.cle} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="jeux" value={jeu.cle} disabled={jeu.occupe} defaultChecked={espace?.jeux.includes(jeu.cle)} />
            {jeu.titre}{jeu.occupe ? ' · Autre espace' : ''}
          </label>)}
        </div>
      </fieldset>
    </div>
    {etat.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
    {etat.succes && <p role="status" className="text-sm">{etat.succes}</p>}
    <Soumettre texte={espace ? 'Enregistrer l’espace' : 'Créer l’espace'} attente="Enregistrement…" />
  </form>
}
