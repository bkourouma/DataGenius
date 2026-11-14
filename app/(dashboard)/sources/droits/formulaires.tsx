'use client'

import { useEffect, useId, useState } from 'react'
import { useFormState } from 'react-dom'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RegleDonnees } from '@/lib/auth/data-access'
import { Soumettre } from '../formulaires'
import { ajouterGroupe, enregistrerGroupe, enregistrerRegle } from './actions'

const choix = 'min-h-10 rounded-md border border-input bg-background px-3 text-sm'
const grille = 'mt-2 grid gap-2 sm:grid-cols-2'
const cellule = 'px-4 py-3 align-middle'
const entete = 'px-4 py-2 text-start text-xs font-medium text-muted-foreground'

type Membre = { id: string; email: string; firstName: string; lastName: string }
type GroupeDonnees = { id: string; nom: string; membres: string[] }
type Jeu = { cle: string; titre: string; colonnes: { nom: string; description: string }[] }

function Retour({ erreur, succes }: { erreur?: string; succes?: string }) {
  if (erreur) return <p role="alert" className="text-sm text-destructive">{erreur}</p>
  return succes ? <p role="status" className="text-sm">{succes}</p> : null
}

function FormulaireNouveauGroupe({ onFini }: { onFini: () => void }) {
  const id = useId()
  const [etat, action] = useFormState(ajouterGroupe, {})
  useEffect(() => { if (etat.succes) onFini() }, [etat, onFini])
  return <form action={action} className="space-y-3">
    <div className="grid gap-2"><Label htmlFor={id}>Nom du nouveau groupe</Label><Input id={id} name="nom" maxLength={100} required /></div>
    <Soumettre texte="Créer le groupe" attente="Création…" />
    <Retour {...etat} />
  </form>
}

export function NouveauGroupe() {
  const [ouvert, setOuvert] = useState(false)
  return <Dialog open={ouvert} onOpenChange={setOuvert}>
    <DialogTrigger asChild><Button><Plus aria-hidden />Nouveau groupe</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nouveau groupe</DialogTitle>
        <DialogDescription>Un groupe rassemble des membres auxquels vous ouvrez l’accès à certains jeux.</DialogDescription>
      </DialogHeader>
      <DialogBody><FormulaireNouveauGroupe onFini={() => setOuvert(false)} /></DialogBody>
    </DialogContent>
  </Dialog>
}

function FormulaireGroupe({ groupe, membres, onFini }: { groupe: GroupeDonnees; membres: Membre[]; onFini: () => void }) {
  const id = useId()
  const [etat, action] = useFormState(enregistrerGroupe, {})
  useEffect(() => { if (etat.succes) onFini() }, [etat, onFini])
  return <form action={action} className="space-y-4">
    <input type="hidden" name="id" value={groupe.id} />
    <div className="grid gap-2"><Label htmlFor={id}>Nom du groupe</Label><Input id={id} name="nom" maxLength={100} required defaultValue={groupe.nom} /></div>
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
}

function LigneGroupe({ groupe, membres }: { groupe: GroupeDonnees; membres: Membre[] }) {
  const [ouvert, setOuvert] = useState(false)
  return <tr>
    <th scope="row" className={cellule + ' text-start font-medium'}>{groupe.nom}</th>
    <td className={cellule}><Badge variant="outline">{groupe.membres.length} membre(s)</Badge></td>
    <td className={cellule + ' text-end'}>
      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogTrigger asChild><Button variant="outline" size="sm" aria-label={`Modifier le groupe ${groupe.nom}`}>Modifier</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Modifier le groupe</DialogTitle><DialogDescription>{groupe.nom}</DialogDescription></DialogHeader>
          <DialogBody><FormulaireGroupe groupe={groupe} membres={membres} onFini={() => setOuvert(false)} /></DialogBody>
        </DialogContent>
      </Dialog>
    </td>
  </tr>
}

export function TableauGroupes({ groupes, membres }: { groupes: GroupeDonnees[]; membres: Membre[] }) {
  return <div className="overflow-x-auto rounded-lg border bg-card">
    <table className="w-full text-sm">
      <thead><tr className="border-b">
        <th scope="col" className={entete}>Groupe</th>
        <th scope="col" className={entete}>Membres</th>
        <th scope="col" className={entete + ' text-end'}><span className="sr-only">Actions</span></th>
      </tr></thead>
      <tbody className="divide-y">{groupes.map(g => <LigneGroupe key={JSON.stringify(g)} groupe={g} membres={membres} />)}</tbody>
    </table>
  </div>
}

function FormulaireRegle({ jeu, groupes, regle, onFini }: {
  jeu: Jeu
  groupes: { id: string; nom: string }[]
  regle?: RegleDonnees
  onFini: () => void
}) {
  const id = useId()
  const [etat, action] = useFormState(enregistrerRegle, {})
  useEffect(() => { if (etat.succes) onFini() }, [etat, onFini])
  return <form action={action} className="space-y-4">
    <input type="hidden" name="jeu" value={jeu.cle} />
    <div className="grid gap-2"><Label htmlFor={id + '-mode'}>Accès au jeu</Label>
      <select id={id + '-mode'} className={choix} name="mode" defaultValue={regle ? 'restreint' : 'ouvert'}>
        <option value="ouvert">Tous les membres</option><option value="restreint">Groupes sélectionnés</option>
      </select>
    </div>
    <fieldset>
      <legend className="text-sm font-medium">Groupes autorisés en mode restreint</legend>
      <p className="text-sm text-muted-foreground">Une sélection vide réserve le jeu aux administrateurs.</p>
      {groupes.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Aucun groupe n’existe encore.</p>}
      <div className={grille}>{groupes.map(g => <label key={g.id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="groupes" value={g.id} defaultChecked={regle?.groupes.includes(g.id)} />{g.nom}
      </label>)}</div>
    </fieldset>
    <fieldset>
      <legend className="text-sm font-medium">Colonnes à masquer pour les membres autorisés</legend>
      {jeu.colonnes.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Ce jeu n’a aucune colonne à masquer.</p>}
      <div className={grille}>{jeu.colonnes.map(c => <label key={c.nom} className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="masquer" value={c.nom} defaultChecked={regle?.masquer.includes(c.nom)} />{c.description}
      </label>)}</div>
    </fieldset>
    <fieldset>
      <legend className="text-sm font-medium">Lignes à conserver en mode restreint</legend>
      <div className={grille}>
        <div className="grid gap-2"><Label htmlFor={id + '-col'}>Colonne du filtre</Label>
          <select id={id + '-col'} className={choix} name="filtreColonne" defaultValue={regle?.filtre?.colonne ?? ''}>
            <option value="">Toutes les lignes</option>
            {jeu.colonnes.map(c => <option key={c.nom} value={c.nom}>{c.description}</option>)}
          </select>
        </div>
        <div className="grid gap-2"><Label htmlFor={id + '-val'}>Valeur exacte</Label><Input id={id + '-val'} name="filtreValeur" maxLength={500} defaultValue={regle?.filtre?.valeur ?? ''} /></div>
      </div>
    </fieldset>
    <Soumettre texte="Enregistrer les droits" attente="Enregistrement…" />
    <Retour {...etat} />
  </form>
}

function LigneJeu({ jeu, groupes, regle }: { jeu: Jeu; groupes: { id: string; nom: string }[]; regle?: RegleDonnees }) {
  const [ouvert, setOuvert] = useState(false)
  const autorises = regle
    ? regle.groupes.map(id => groupes.find(g => g.id === id)?.nom).filter(Boolean).join(', ') || 'Administrateurs uniquement'
    : 'Tous les membres'
  return <tr>
    <th scope="row" className={cellule + ' text-start font-normal'}>
      <span className="block font-medium">{jeu.titre}</span>
      <span className="block font-mono text-xs text-muted-foreground">{jeu.cle}</span>
    </th>
    <td className={cellule}><Badge variant={regle ? 'warning' : 'success'}>{regle ? 'Restreint' : 'Ouvert'}</Badge></td>
    <td className={cellule + ' text-muted-foreground'}>{autorises}</td>
    <td className={cellule + ' text-end'}>
      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogTrigger asChild><Button variant="outline" size="sm" aria-label={`Modifier les droits de ${jeu.titre}`}>Modifier</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Droits du jeu</DialogTitle><DialogDescription>{jeu.titre}</DialogDescription></DialogHeader>
          <DialogBody><FormulaireRegle jeu={jeu} groupes={groupes} regle={regle} onFini={() => setOuvert(false)} /></DialogBody>
        </DialogContent>
      </Dialog>
    </td>
  </tr>
}

export function TableauJeux({ jeux, groupes, regles }: {
  jeux: Jeu[]
  groupes: { id: string; nom: string }[]
  regles: Map<string, RegleDonnees>
}) {
  return <div className="overflow-x-auto rounded-lg border bg-card">
    <table className="w-full text-sm">
      <thead><tr className="border-b">
        <th scope="col" className={entete}>Jeu</th>
        <th scope="col" className={entete}>Accès</th>
        <th scope="col" className={entete}>Groupes autorisés</th>
        <th scope="col" className={entete + ' text-end'}><span className="sr-only">Actions</span></th>
      </tr></thead>
      <tbody className="divide-y">{jeux.map(j => <LigneJeu key={j.cle + JSON.stringify(regles.get(j.cle) ?? null)} jeu={j} groupes={groupes} regle={regles.get(j.cle)} />)}</tbody>
    </table>
  </div>
}
