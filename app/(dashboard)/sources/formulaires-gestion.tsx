'use client'

import { useId } from 'react'
import { useFormState } from 'react-dom'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('sources.gestion')
  const tf = useTranslations('sources.formulaires')
  const id = useId()
  const [etat, action] = useFormState(modifierConnexion, {})
  const secret = connexion.avecSecret ? t('secretConserver') : undefined
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="sourceId" value={sourceId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor={id + '-titre'}>{tf('nomSource')}</Label><Input id={id + '-titre'} name="titre" defaultValue={connexion.titre} required maxLength={120} /></div>
        {connexion.type === 'rest' && <>
          <div className="grid gap-2"><Label htmlFor={id + '-url'}>{tf('urlApi')}</Label><Input id={id + '-url'} name="url" type="url" defaultValue={connexion.url} required maxLength={2000} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-token'}>{t('jeton')}</Label><Input id={id + '-token'} name="token" type="password" autoComplete="new-password" placeholder={secret} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-chemin'}>{tf('cheminFacultatif')}</Label><Input id={id + '-chemin'} name="chemin" defaultValue={connexion.chemin} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-page'}>{tf('parametrePageFacultatif')}</Label><Input id={id + '-page'} name="parametrePage" defaultValue={connexion.parametrePage} /></div>
        </>}
        {(connexion.type === 'postgresql' || connexion.type === 'mysql') && <>
          <div className="grid gap-2"><Label htmlFor={id + '-base'}>{tf('nomBase')}</Label><Input id={id + '-base'} name="base" defaultValue={connexion.base} required maxLength={63} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-hote'}>{tf('hote')}</Label><Input id={id + '-hote'} name="hote" defaultValue={connexion.hote} required maxLength={253} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-port'}>{tf('port')}</Label><Input id={id + '-port'} name="port" type="number" defaultValue={connexion.port} min={1} max={65535} required /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-utilisateur'}>{tf('utilisateurLecture')}</Label><Input id={id + '-utilisateur'} name="utilisateur" defaultValue={connexion.utilisateur} required maxLength={63} autoComplete="off" /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-mdp'}>{tf('motDePasse')}</Label><Input id={id + '-mdp'} name="motDePasse" type="password" maxLength={1024} autoComplete="new-password" placeholder={secret} /></div>
          <div className="grid gap-2"><Label htmlFor={id + '-tls'}>{tf('tls')}</Label>
            <select id={id + '-tls'} name="tls" defaultValue={connexion.tls} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="require">{tf('tlsRequise')}</option><option value="disable">{tf('tlsDesactivee')}</option>
            </select>
          </div>
        </>}
      </div>
      {connexion.type !== 'fichier' && <p className="text-sm text-muted-foreground">{t('aideConnexion')}</p>}
      <Retour {...etat} />
      <Soumettre texte={connexion.type === 'fichier' ? t('enregistrerNom') : t('testerEnregistrer')} attente={t('enregistrement')} />
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
  const t = useTranslations('sources.gestion')
  const id = useId()
  const [etat, action] = useFormState(supprimerConnexion, {})
  if (imports.length > 0) {
    return (
      <div className="space-y-2 text-sm">
        <p>{t('suppressionImpossibleImports')}</p>
        <ul className="list-disc ps-5">{imports.map(i => <li key={i.cle}>{i.titre}</li>)}</ul>
      </div>
    )
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="sourceId" value={sourceId} />
      <p className="text-sm text-muted-foreground">{t('aucunImport')}</p>
      <Confirmation id={id + '-ok'} texte={t('confirmerSource')} />
      <Retour {...etat} />
      <Soumettre texte={t('supprimerSource')} attente={t('suppression')} variant="destructive" />
    </form>
  )
}

function ListeDependances({ dependances }: { dependances: DependancesAffichees }) {
  const t = useTranslations('sources.gestion')
  const mentions = [
    dependances.catalogue && t('depCatalogue'),
    dependances.droits && t('depDroits'),
    dependances.qualite && t('depQualite'),
    dependances.incremental && t('depIncremental'),
  ].filter(Boolean) as string[]
  return (
    <ul className="list-disc space-y-1 ps-5 text-sm">
      {dependances.combinaisons.map(c => <li key={c.cle}>{t('depCombine', { titre: c.titre })}</li>)}
      {dependances.tableaux.map(tb => <li key={tb.id}>{t('depTableau', { titre: tb.titre })}</li>)}
      {dependances.espaces.map(e => <li key={e.id}>{t('depEspace', { nom: e.nom })}</li>)}
      {mentions.map(m => <li key={m}>{m}</li>)}
    </ul>
  )
}

export function FormulaireGestionJeu({ cle, titre, dependances }: { cle: string; titre: string; dependances: DependancesAffichees | null }) {
  const t = useTranslations('sources.gestion')
  const tf = useTranslations('sources.formulaires')
  const id = useId()
  const [etatNom, actionNom] = useFormState(renommerJeu, {})
  const [etatSup, actionSup] = useFormState(supprimerJeu, {})
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">{t('renommerSupprimer')}<span className="sr-only">{' '}{titre}</span></summary>
      <div className="mt-3 space-y-5">
        <form action={actionNom} className="space-y-2">
          <input type="hidden" name="jeu" value={cle} />
          <Label htmlFor={id + '-titre'}>{tf('nomJeu')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input id={id + '-titre'} className="max-w-sm" name="titre" defaultValue={titre} required maxLength={120} />
            <Soumettre texte={t('renommer')} attente={t('enregistrement')} variant="outline" />
          </div>
          <Retour {...etatNom} />
        </form>
        <div className="space-y-3 border-t pt-4">
          <h4 className="text-sm font-semibold">{t('supprimerImport')}</h4>
          {dependances === null && <p role="status" className="text-sm">{t('depIndisponibles')}</p>}
          {dependances && dependances.combinaisons.length > 0 && <>
            <p className="text-sm">{t('impossibleJeuxCombines')}</p>
            <ListeDependances dependances={{ ...dependances, tableaux: [], espaces: [], catalogue: false, droits: false, qualite: false, incremental: false }} />
          </>}
          {dependances && dependances.combinaisons.length === 0 && (
            <form action={actionSup} className="space-y-3">
              <input type="hidden" name="jeu" value={cle} />
              <p className="text-sm">{t('donneesSupprimees')}</p>
              {dependances.tableaux.length > 0 && <p className="text-sm">{t('tuilesIndisponibles')}</p>}
              <ListeDependances dependances={dependances} />
              <Confirmation id={id + '-ok'} texte={t('confirmerJeu', { titre })} />
              <Retour {...etatSup} />
              <Soumettre texte={t('supprimerImport')} attente={t('suppression')} variant="destructive" />
            </form>
          )}
        </div>
      </div>
    </details>
  )
}

export function FormulaireSupprimerCombinaison({ cle, titre, dependances }: { cle: string; titre: string; dependances: DependancesAffichees | null }) {
  const t = useTranslations('sources.gestion')
  const id = useId()
  const [etat, action] = useFormState(supprimerJeuCombine, {})
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">{t('supprimer')}<span className="sr-only">{' '}{titre}</span></summary>
      <div className="mt-3 space-y-3">
        {dependances === null && <p role="status" className="text-sm">{t('depIndisponibles')}</p>}
        {dependances && dependances.combinaisons.length > 0 && <>
          <p className="text-sm">{t('impossibleAutresCombines')}</p>
          <ListeDependances dependances={{ ...dependances, tableaux: [], espaces: [], catalogue: false, droits: false, qualite: false, incremental: false }} />
        </>}
        {dependances && dependances.combinaisons.length === 0 && (
          <form action={action} className="space-y-3">
            <input type="hidden" name="jeu" value={cle} />
            <p className="text-sm">{t('jeuCombineSupprime')}</p>
            {dependances.tableaux.length > 0 && <p className="text-sm">{t('tuilesIndisponibles')}</p>}
            <ListeDependances dependances={dependances} />
            <Confirmation id={id + '-ok'} texte={t('confirmerJeu', { titre })} />
            <Retour {...etat} />
            <Soumettre texte={t('supprimerJeuCombine')} attente={t('suppression')} variant="destructive" />
          </form>
        )}
      </div>
    </details>
  )
}
