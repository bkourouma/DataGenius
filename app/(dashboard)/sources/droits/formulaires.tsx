'use client'

import { useFormState } from 'react-dom'
import { Input } from '@/components/ui/input'
import type { RegleDonnees } from '@/lib/auth/data-access'
import { Soumettre } from '../formulaires'
import { ajouterGroupe, enregistrerGroupe, enregistrerRegle } from './actions'

const choix = 'min-h-10 rounded-md border border-input bg-background px-3 text-sm'
const grille = 'mt-2 grid gap-2 sm:grid-cols-2'

function Retour({ erreur, succes }: { erreur?: string; succes?: string }) {
  if (erreur) return <p role="alert" className="text-sm text-destructive">{erreur}</p>
  return succes ? <p role="status" className="text-sm">{succes}</p> : null
}

export function NouveauGroupe() {
  const [etat, action] = useFormState(ajouterGroupe, {})
  return <form action={action} className="space-y-3">
    <label className="block text-sm">Nom du nouveau groupe<Input name="nom" maxLength={100} required /></label>
    <Soumettre texte="Créer le groupe" attente="Création…" />
    <Retour {...etat} />
  </form>
}

export function Groupe({ groupe, membres }: {
  groupe: { id: string; nom: string; membres: string[] }
  membres: { id: string; email: string; firstName: string; lastName: string }[]
}) {
  const [etat, action] = useFormState(enregistrerGroupe, {})
  return <details className="rounded-md border p-4">
    <summary className="cursor-pointer font-medium">{groupe.nom} · {groupe.membres.length} membre(s)</summary>
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="id" value={groupe.id} />
      <label className="block text-sm">Nom du groupe<Input name="nom" maxLength={100} required defaultValue={groupe.nom} /></label>
      <fieldset>
        <legend className="text-sm font-medium">Membres actifs</legend>
        {membres.length === 0 && <p className="text-sm text-muted-foreground">Aucun compte membre actif.</p>}
        <div className={grille}>{membres.map(m => <label key={m.id} className="flex items-start gap-2 text-sm">
          <input className="mt-1" type="checkbox" name="membres" value={m.id} defaultChecked={groupe.membres.includes(m.id)} />
          <span>{m.firstName} {m.lastName} <span className="text-muted-foreground">({m.email})</span></span>
        </label>)}</div>
      </fieldset>
      <Soumettre texte="Enregistrer le groupe" attente="Enregistrement…" />
      <Retour {...etat} />
    </form>
  </details>
}

export function RegleJeu({ jeu, groupes, regle }: {
  jeu: { cle: string; titre: string; colonnes: { nom: string; description: string }[] }
  groupes: { id: string; nom: string }[]
  regle?: RegleDonnees
}) {
  const [etat, action] = useFormState(enregistrerRegle, {})
  return <details className="rounded-md border p-4">
    <summary className="cursor-pointer font-medium">{jeu.titre} · {regle ? 'Restreint' : 'Ouvert'}</summary>
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="jeu" value={jeu.cle} />
      <label className="flex flex-col gap-1 text-sm">Accès au jeu
        <select className={choix} name="mode" defaultValue={regle ? 'restreint' : 'ouvert'}>
          <option value="ouvert">Tous les membres</option><option value="restreint">Groupes sélectionnés</option>
        </select>
      </label>
      <fieldset>
        <legend className="text-sm font-medium">Groupes autorisés en mode restreint</legend>
        <p className="text-sm text-muted-foreground">Une sélection vide réserve le jeu aux administrateurs.</p>
        <div className={grille}>{groupes.map(g => <label key={g.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="groupes" value={g.id} defaultChecked={regle?.groupes.includes(g.id)} />{g.nom}
        </label>)}</div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium">Colonnes à masquer pour les membres autorisés</legend>
        <div className={grille}>{jeu.colonnes.map(c => <label key={c.nom} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="masquer" value={c.nom} defaultChecked={regle?.masquer.includes(c.nom)} />{c.description}
        </label>)}</div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium">Lignes à conserver en mode restreint</legend>
        <div className={grille}>
          <label className="flex flex-col gap-1 text-sm">Colonne du filtre
            <select className={choix} name="filtreColonne" defaultValue={regle?.filtre?.colonne ?? ''}>
              <option value="">Toutes les lignes</option>
              {jeu.colonnes.map(c => <option key={c.nom} value={c.nom}>{c.description}</option>)}
            </select>
          </label>
          <label className="block text-sm">Valeur exacte<Input name="filtreValeur" maxLength={500} defaultValue={regle?.filtre?.valeur ?? ''} /></label>
        </div>
      </fieldset>
      <Soumettre texte="Enregistrer les droits" attente="Enregistrement…" />
      <Retour {...etat} />
    </form>
  </details>
}
