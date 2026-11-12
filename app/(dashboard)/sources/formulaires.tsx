'use client'

import { useId, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ajouterConnexion, ajouterImport, changerFrequence } from './actions'

export function Soumettre({ texte, attente, variant }: {
  texte: string
  attente: string
  variant?: 'default' | 'outline'
}) {
  const { pending } = useFormStatus()
  return <Button type="submit" size="sm" variant={variant} disabled={pending}>{pending ? attente : texte}</Button>
}

function Retour({ erreur, succes }: { erreur?: string; succes?: string }) {
  if (erreur) return <p role="alert" className="text-sm text-destructive">{erreur}</p>
  if (succes) return <p role="status" className="text-sm">{succes}</p>
  return null
}

export function FormulaireConnexion() {
  const [etat, action] = useFormState(ajouterConnexion, {})
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor="source-titre">Nom de la source</Label><Input id="source-titre" name="titre" required maxLength={120} /></div>
        <div className="grid gap-2"><Label htmlFor="source-base">Nom de la base</Label><Input id="source-base" name="base" required maxLength={63} /></div>
        <div className="grid gap-2"><Label htmlFor="source-hote">Hôte</Label><Input id="source-hote" name="hote" required maxLength={253} /></div>
        <div className="grid gap-2"><Label htmlFor="source-port">Port</Label><Input id="source-port" name="port" type="number" defaultValue={5432} min={1} max={65535} required /></div>
        <div className="grid gap-2"><Label htmlFor="source-utilisateur">Utilisateur de lecture</Label><Input id="source-utilisateur" name="utilisateur" required maxLength={63} autoComplete="off" /></div>
        <div className="grid gap-2"><Label htmlFor="source-mdp">Mot de passe</Label><Input id="source-mdp" name="motDePasse" type="password" maxLength={1024} autoComplete="new-password" /></div>
        <div className="grid gap-2"><Label htmlFor="source-tls">Connexion TLS</Label>
          <select id="source-tls" name="tls" defaultValue="require" className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="require">Requise</option><option value="disable">Désactivée (réseau de confiance)</option>
          </select>
        </div>
      </div>
      <Retour {...etat} />
      <Soumettre texte="Tester et ajouter la source" attente="Connexion en cours…" />
    </form>
  )
}

export function FormulaireImport({ sourceId, schema, table, colonnes }: {
  sourceId: string
  schema: string
  table: string
  colonnes: { nom: string; typePostgres: string }[]
}) {
  const [etat, action] = useFormState(ajouterImport, {})
  const [selection, setSelection] = useState<string[]>([])
  const [filtre, setFiltre] = useState('')
  const visibles = colonnes.filter(c => c.nom.toLowerCase().includes(filtre.toLowerCase()))
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="schema" value={schema} />
      <input type="hidden" name="table" value={table} />
      {selection.map(nom => <input key={nom} type="hidden" name="colonnes" value={nom} />)}
      <div className="grid gap-2"><Label htmlFor="import-titre">Nom du jeu</Label><Input id="import-titre" name="titre" defaultValue={table} maxLength={120} required /></div>
      <div className="grid gap-2"><Label htmlFor="import-description">Description (facultative)</Label><Textarea id="import-description" name="description" maxLength={300} rows={2} /></div>
      <fieldset className="space-y-2">
        <legend className="font-medium">Colonnes à importer</legend>
        <Input aria-label="Filtrer les colonnes" placeholder="Filtrer les colonnes" value={filtre} onChange={e => setFiltre(e.target.value)} />
        <p className="text-sm text-muted-foreground" aria-live="polite">{selection.length} colonne(s) sélectionnée(s) sur 50 possibles</p>
        <ul className="max-h-72 divide-y overflow-auto rounded-md border">
          {visibles.map(({ nom, typePostgres }) => {
            const coche = selection.includes(nom)
            return (
              <li key={nom}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                  <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={coche} disabled={!coche && selection.length === 50}
                    onChange={e => setSelection(e.target.checked ? [...selection, nom] : selection.filter(c => c !== nom))} />
                  <span className="min-w-0 flex-1 break-all">{nom}</span>
                  <span className="text-muted-foreground">{typePostgres}</span>
                </label>
              </li>
            )
          })}
          {visibles.length === 0 && <li className="p-3 text-sm text-muted-foreground">Aucune colonne correspondante.</li>}
        </ul>
      </fieldset>
      <div className="grid gap-2"><Label htmlFor="import-frequence">Fréquence (minutes)</Label><Input id="import-frequence" className="max-w-40" name="frequenceMinutes" type="number" min={1} max={10080} defaultValue={60} required /></div>
      <Retour {...etat} />
      <Soumettre texte="Enregistrer l’import" attente="Enregistrement…" />
    </form>
  )
}

export function FormulaireFrequence({ cle, frequence }: { cle: string; frequence: number }) {
  const [etat, action] = useFormState(changerFrequence, {})
  const id = useId()
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="jeu" value={cle} />
      <Label htmlFor={id}>Fréquence (minutes)</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id={id} className="max-w-28" name="frequenceMinutes" type="number" min={1} max={10080} defaultValue={frequence} required />
        <Soumettre texte="Enregistrer la fréquence" attente="Enregistrement…" variant="outline" />
      </div>
      <Retour {...etat} />
    </form>
  )
}
