'use client'

import { useId, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ajouterConnexion, ajouterConnexionRest, ajouterImport, changerFrequence, importerFichierSource, actualiserJeu } from './actions'

export function Soumettre({ texte, attente, variant }: {
  texte: string
  attente: string
  variant?: 'default' | 'outline' | 'destructive'
}) {
  const { pending } = useFormStatus()
  return <Button type="submit" size="sm" variant={variant} disabled={pending}>{pending ? attente : texte}</Button>
}

export function Retour({ erreur, succes }: { erreur?: string; succes?: string }) {
  if (erreur) return <p role="alert" className="text-sm text-destructive">{erreur}</p>
  if (succes) return <p role="status" className="text-sm">{succes}</p>
  return null
}

export function FormulaireConnexion({ moteur = 'postgresql' }: { moteur?: 'postgresql' | 'mysql' }) {
  const t = useTranslations('sources.formulaires')
  const id = useId()
  const [etat, action] = useFormState(ajouterConnexion, {})
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="moteur" value={moteur} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor={id + '-titre'}>{t('nomSource')}</Label><Input id={id + '-titre'} name="titre" required maxLength={120} /></div>
        <div className="grid gap-2"><Label htmlFor={id + '-base'}>{t('nomBase')}</Label><Input id={id + '-base'} name="base" required maxLength={63} /></div>
        <div className="grid gap-2"><Label htmlFor={id + '-hote'}>{t('hote')}</Label><Input id={id + '-hote'} name="hote" required maxLength={253} /></div>
        <div className="grid gap-2"><Label htmlFor={id + '-port'}>{t('port')}</Label><Input id={id + '-port'} name="port" type="number" defaultValue={moteur === 'mysql' ? 3306 : 5432} min={1} max={65535} required /></div>
        <div className="grid gap-2"><Label htmlFor={id + '-utilisateur'}>{t('utilisateurLecture')}</Label><Input id={id + '-utilisateur'} name="utilisateur" required maxLength={63} autoComplete="off" /></div>
        <div className="grid gap-2"><Label htmlFor={id + '-mdp'}>{t('motDePasse')}</Label><Input id={id + '-mdp'} name="motDePasse" type="password" maxLength={1024} autoComplete="new-password" /></div>
        <div className="grid gap-2"><Label htmlFor={id + '-tls'}>{t('tls')}</Label>
          <select id={id + '-tls'} name="tls" defaultValue="require" className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="require">{t('tlsRequise')}</option><option value="disable">{t('tlsDesactivee')}</option>
          </select>
        </div>
      </div>
      <Retour {...etat} />
      <Soumettre texte={t('testerAjouter')} attente={t('connexionEnCours')} />
    </form>
  )
}

export function FormulaireConnexionRest() {
  const t = useTranslations('sources.formulaires')
  const id = useId()
  const [etat, action] = useFormState(ajouterConnexionRest, {})
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor={id + '-titre'}>{t('nomSource')}</Label><Input id={id + '-titre'} name="titre" required maxLength={120} /></div>
        <div className="grid gap-2"><Label htmlFor={id + '-url'}>{t('urlApi')}</Label><Input id={id + '-url'} name="url" type="url" required maxLength={2000} /></div>
        <div className="grid gap-2"><Label htmlFor={id + '-token'}>{t('jetonFacultatif')}</Label><Input id={id + '-token'} name="token" type="password" autoComplete="new-password" /></div>
        <div className="grid gap-2"><Label htmlFor={id + '-chemin'}>{t('cheminFacultatif')}</Label><Input id={id + '-chemin'} name="chemin" placeholder={t('exempleChemin')} /></div>
        <div className="grid gap-2"><Label htmlFor={id + '-page'}>{t('parametrePageFacultatif')}</Label><Input id={id + '-page'} name="parametrePage" placeholder={t('exempleParametrePage')} /></div>
      </div>
      <Retour {...etat} />
      <Soumettre texte={t('testerAjouter')} attente={t('connexionEnCours')} />
    </form>
  )
}

export function FormulaireFichierSource({ sourceId }: { sourceId?: string }) {
  const t = useTranslations('sources.formulaires')
  const id = useId()
  const [etat, action] = useFormState(importerFichierSource, {})
  return (
    <form action={action} className="space-y-4">
      {sourceId ? <input type="hidden" name="sourceId" value={sourceId} /> :
        <div className="grid gap-2"><Label htmlFor={id + '-titre'}>{t('nomSource')}</Label><Input id={id + '-titre'} name="titre" required maxLength={120} /></div>}
      <div className="grid gap-2">
        <Label htmlFor={id + '-fichier'}>{t('fichierCsvExcel')}</Label>
        <Input id={id + '-fichier'} name="fichier" type="file" required accept=".csv,.xlsx" />
        <p className="text-sm text-muted-foreground">{t('limitesFichier')}</p>
      </div>
      <Retour {...etat} />
      <Soumettre texte={sourceId ? t('remplacerFichier') : t('ajouterSource')} attente={t('importEnCours')} />
    </form>
  )
}

export function FormulaireImport({ sourceId, schema, table, colonnes }: {
  sourceId: string
  schema: string
  table: string
  colonnes: { nom: string; typePostgres: string }[]
}) {
  const t = useTranslations('sources.formulaires')
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
      <div className="grid gap-2"><Label htmlFor="import-titre">{t('nomJeu')}</Label><Input id="import-titre" name="titre" defaultValue={table} maxLength={120} required /></div>
      <div className="grid gap-2"><Label htmlFor="import-description">{t('descriptionFacultative')}</Label><Textarea id="import-description" name="description" maxLength={300} rows={2} /></div>
      <fieldset className="space-y-2">
        <legend className="font-medium">{t('colonnesAImporter')}</legend>
        <Input aria-label={t('filtrerColonnes')} placeholder={t('filtrerColonnes')} value={filtre} onChange={e => setFiltre(e.target.value)} />
        <p className="text-sm text-muted-foreground" aria-live="polite">{t('colonnesSelectionnees', { n: selection.length })}</p>
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
          {visibles.length === 0 && <li className="p-3 text-sm text-muted-foreground">{t('aucuneColonne')}</li>}
        </ul>
      </fieldset>
      <div className="grid gap-2"><Label htmlFor="import-frequence">{t('frequenceMinutes')}</Label><Input id="import-frequence" className="max-w-40" name="frequenceMinutes" type="number" min={1} max={10080} defaultValue={60} required /></div>
      <Retour {...etat} />
      <Soumettre texte={t('enregistrerImport')} attente={t('enregistrement')} />
    </form>
  )
}

export function FormulaireFrequence({ cle, frequence }: { cle: string; frequence: number }) {
  const t = useTranslations('sources.formulaires')
  const [etat, action] = useFormState(changerFrequence, {})
  const id = useId()
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="jeu" value={cle} />
      <Label htmlFor={id}>{t('frequenceMinutes')}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id={id} className="max-w-28" name="frequenceMinutes" type="number" min={1} max={10080} defaultValue={frequence} required />
        <Soumettre texte={t('enregistrerFrequence')} attente={t('enregistrement')} variant="outline" />
      </div>
      <Retour {...etat} />
    </form>
  )
}

export function FormulaireActualiser({ cle, titre }: { cle: string; titre: string }) {
  const t = useTranslations('sources.formulaires')
  const [etat, action] = useFormState(actualiserJeu, {})
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="jeu" value={cle} />
      <Soumettre texte={t('synchroniser', { titre })} attente={t('synchroEnCours')} variant="outline" />
      <Retour {...etat} />
    </form>
  )
}
