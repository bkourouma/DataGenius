'use client'

import { useId } from 'react'
import { useFormState } from 'react-dom'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { modifierConnexion, renommerJeu, supprimerConnexion, supprimerJeu } from './actions'
import { supprimerJeuCombine } from './combiner/actions'
import { Retour, Soumettre } from './formulaires'

export type ConnexionModifiable = {
  type: 'postgresql' | 'mysql' | 'rest' | 'fichier'
  titre: string; hote: string; port: string; base: string; utilisateur: string
  tls: 'require' | 'disable'; url: string; chemin: string; parametrePage: string; avecSecret: boolean
}

export type DependancesAffichees = {
  combinaisons: { cle: string; titre: string }[]
  tableaux: { id: string; titre: string }[]
  espaces: { id: string; nom: string }[]
  catalogue: boolean; droits: boolean; qualite: boolean; incremental: boolean
}

export function FormulaireModifierConnexion({ sourceId, connexion }: { sourceId: string; connexion: ConnexionModifiable }) {
  const id = useId()
  const [etat, action] = useFormState(modifierConnexion, {})
  const secret = connexion.avecSecret ? 'Laisser vide pour conserver l’actuel' : undefined
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="sourceId" value={sourceId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor={id + '-titre'}>Nom de la source</Label><Input id={id + '-titre'} name="titre" defaultValue={connexion.titre} required maxLength={120} /></div>
        {connexion.type === 'rest' && <>
          <div className="grid gap-2"><Label htmlFor={id + '-url'}>URL de l’API</Label><Input id={id + '-url'} name="url" type="url" defaultValue={connexion.url} required maxLength={2000} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-token'}>Jeton d’accès</Label><Input id={id + '-token'} name="token" type="password" autoComplete="new-password" placeholder={secret} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-chemin'}>Chemin du tableau JSON (facultatif)</Label><Input id={id + '-chemin'} name="chemin" defaultValue={connexion.chemin} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-page'}>Paramètre de page (facultatif)</Label><Input id={id + '-page'} name="parametrePage" defaultValue={connexion.parametrePage} /></div>
        </>}
        {(connexion.type === 'postgresql' || connexion.type === 'mysql') && <>
          <div className="grid gap-2"><Label htmlFor={id + '-base'}>Nom de la base</Label><Input id={id + '-base'} name="base" defaultValue={connexion.base} required maxLength={63} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-hote'}>Hôte</Label><Input id={id + '-hote'} name="hote" defaultValue={connexion.hote} required maxLength={253} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-port'}>Port</Label><Input id={id + '-port'} name="port" type="number" defaultValue={connexion.port} min={1} max={65535} required /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-utilisateur'}>Utilisateur de lecture</Label><Input id={id + '-utilisateur'} name="utilisateur" defaultValue={connexion.utilisateur} required maxLength={63} autoComplete="off" /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-mdp'}>Mot de passe</Label><Input id={id + '-mdp'} name="motDePasse" type="password" maxLength={1024} autoComplete="new-password" placeholder={secret} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-tls'}>Connexion TLS</Label>
            <select id={id + '-tls'} name="tls" defaultValue={connexion.tls} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="require">Requise</option><option value="disable">Désactivée (réseau de confiance)</option>
            </select>
          </div>
        </>}
      </div>
      {connexion.type !== 'fichier' && <p className="text-sm text-muted-foreground">La connexion est testée avant l’enregistrement. En cas d’échec, les paramètres actuels sont conservés. Laissez le mot de passe ou le jeton vide pour conserver l’actuel, sauf si vous changez l’hôte, le port, la base, l’utilisateur ou l’origine de l’URL : ressaisissez-le alors.</p>}
      <Retour {...etat} />
      <Soumettre texte={connexion.type === 'fichier' ? 'Enregistrer le nom' : 'Tester et enregistrer'} attente="Enregistrement…" />
    </form>
  )
}

function Confirmation({ id, texte }: { id: string; texte: string }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm">
      <input id={id} type="checkbox" name="confirmation" required className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span>{texte}</span>
    </label>
  )
}

export function FormulaireSupprimerConnexion({ sourceId, imports }: { sourceId: string; imports: { cle: string; titre: string }[] }) {
  const id = useId()
  const [etat, action] = useFormState(supprimerConnexion, {})
  if (imports.length > 0) {
    return (
      <div className="space-y-2 text-sm">
        <p>La suppression est impossible tant que des imports utilisent cette source. Supprimez-les d’abord :</p>
        <ul className="list-disc pl-5">{imports.map(i => <li key={i.cle}>{i.titre}</li>)}</ul>
      </div>
    )
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="sourceId" value={sourceId} />
      <p className="text-sm text-muted-foreground">Aucun import n’utilise cette source. Ses identifiants de connexion seront supprimés.</p>
      <Confirmation id={id + '-ok'} texte="Je confirme la suppression définitive de cette source" />
      <Retour {...etat} />
      <Soumettre texte="Supprimer la source" attente="Suppression…" variant="destructive" />
    </form>
  )
}

function ListeDependances({ dependances }: { dependances: DependancesAffichees }) {
  const mentions = [
    dependances.catalogue && 'Catalogue métier publié',
    dependances.droits && 'Règle de droits d’accès',
    dependances.qualite && 'Suivi de qualité',
    dependances.incremental && 'Synchronisation incrémentale',
  ].filter(Boolean) as string[]
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {dependances.combinaisons.map(c => <li key={c.cle}>Jeu combiné : {c.titre}</li>)}
      {dependances.tableaux.map(t => <li key={t.id}>Tableau de bord : {t.titre}</li>)}
      {dependances.espaces.map(e => <li key={e.id}>Espace : {e.nom}</li>)}
      {mentions.map(m => <li key={m}>{m}</li>)}
    </ul>
  )
}

export function FormulaireGestionJeu({ cle, titre, dependances }: { cle: string; titre: string; dependances: DependancesAffichees | null }) {
  const id = useId()
  const [etatNom, actionNom] = useFormState(renommerJeu, {})
  const [etatSup, actionSup] = useFormState(supprimerJeu, {})
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">Renommer ou supprimer<span className="sr-only"> {titre}</span></summary>
      <div className="mt-3 space-y-5">
        <form action={actionNom} className="space-y-2">
          <input type="hidden" name="jeu" value={cle} />
          <Label htmlFor={id + '-titre'}>Nom du jeu</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input id={id + '-titre'} className="max-w-sm" name="titre" defaultValue={titre} required maxLength={120} />
            <Soumettre texte="Renommer" attente="Enregistrement…" variant="outline" />
          </div>
          <Retour {...etatNom} />
        </form>
        <div className="space-y-3 border-t pt-4">
          <h4 className="text-sm font-semibold">Supprimer l’import</h4>
          {dependances === null && <p role="status" className="text-sm">Dépendances indisponibles pour le moment : la suppression est désactivée.</p>}
          {dependances && dependances.combinaisons.length > 0 && <>
            <p className="text-sm">La suppression est impossible tant que des jeux combinés utilisent cet import. Supprimez-les ou modifiez-les d’abord :</p>
            <ListeDependances dependances={{ ...dependances, tableaux: [], espaces: [], catalogue: false, droits: false, qualite: false, incremental: false }} />
          </>}
          {dependances && dependances.combinaisons.length === 0 && (
            <form action={actionSup} className="space-y-3">
              <input type="hidden" name="jeu" value={cle} />
              <p className="text-sm">Les données publiées et leur historique seront supprimés. Cette action est définitive.</p>
              {dependances.tableaux.length > 0 && <p className="text-sm">Les tuiles de ces tableaux de bord deviendront indisponibles :</p>}
              <ListeDependances dependances={dependances} />
              <Confirmation id={id + '-ok'} texte={'Je confirme la suppression définitive de « ' + titre + ' »'} />
              <Retour {...etatSup} />
              <Soumettre texte="Supprimer l’import" attente="Suppression…" variant="destructive" />
            </form>
          )}
        </div>
      </div>
    </details>
  )
}

export function FormulaireSupprimerCombinaison({ cle, titre, dependances }: { cle: string; titre: string; dependances: DependancesAffichees | null }) {
  const id = useId()
  const [etat, action] = useFormState(supprimerJeuCombine, {})
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">Supprimer<span className="sr-only"> {titre}</span></summary>
      <div className="mt-3 space-y-3">
        {dependances === null && <p role="status" className="text-sm">Dépendances indisponibles pour le moment : la suppression est désactivée.</p>}
        {dependances && dependances.combinaisons.length > 0 && <>
          <p className="text-sm">La suppression est impossible tant que d’autres jeux combinés utilisent ce jeu :</p>
          <ListeDependances dependances={{ ...dependances, tableaux: [], espaces: [], catalogue: false, droits: false, qualite: false, incremental: false }} />
        </>}
        {dependances && dependances.combinaisons.length === 0 && (
          <form action={action} className="space-y-3">
            <input type="hidden" name="jeu" value={cle} />
            <p className="text-sm">Le jeu combiné et ses données publiées seront supprimés. Cette action est définitive.</p>
            {dependances.tableaux.length > 0 && <p className="text-sm">Les tuiles de ces tableaux de bord deviendront indisponibles :</p>}
            <ListeDependances dependances={dependances} />
            <Confirmation id={id + '-ok'} texte={'Je confirme la suppression définitive de « ' + titre + ' »'} />
            <Retour {...etat} />
            <Soumettre texte="Supprimer le jeu combiné" attente="Suppression…" variant="destructive" />
          </form>
        )}
      </div>
    </details>
  )
}
