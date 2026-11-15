'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useFormState, useFormStatus } from 'react-dom'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toIntlTag } from '@/i18n/config'
import type { CompteListe } from '@/lib/auth/comptes'
import { changerRole, desactiver, inviter, reactiver, renvoyer, type EtatUtilisateurs } from './actions'

export type CompteAffiche = Omit<CompteListe, 'invitationExpireA'> & { invitationExpireA: string | null }
type ActionServeur = (etat: EtatUtilisateurs, formulaire: FormData) => Promise<EtatUtilisateurs>

const choix = 'min-h-10 rounded-md border border-input bg-background px-3 text-sm [@media(pointer:coarse)]:min-h-11'

/** Date courte en UTC, dans la langue de l'interface (l'arabe garde les chiffres latins, voir i18n/config). */
function useFormaterDate() {
  const locale = useLocale()
  const dateCourte = new Intl.DateTimeFormat(toIntlTag(locale), { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
  return (iso: string | null): string | null => (iso ? `${dateCourte.format(new Date(iso))} UTC` : null)
}

function Soumettre({ texte, attente }: { texte: string; attente: string }) {
  const { pending } = useFormStatus()
  return <Button type="submit" size="sm" disabled={pending}>{pending ? attente : texte}</Button>
}

export function LienInvitation({ lien, expireA }: { lien: string; expireA?: string | null }) {
  const [copie, setCopie] = useState(false)
  const id = useId()
  const t = useTranslations('ecrans.utilisateurs.lien')
  const formaterDate = useFormaterDate()
  async function copier() {
    try {
      await navigator.clipboard.writeText(lien)
      setCopie(true)
    } catch {
      // Repli sans erreur : on sélectionne le champ pour une copie manuelle.
      ;(document.getElementById(id) as HTMLInputElement | null)?.select()
    }
  }
  const echeance = formaterDate(expireA ?? null)
  return <div className="space-y-2 rounded-md border p-3">
    <label htmlFor={id} className="block text-sm font-medium">{t('titre')}</label>
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input id={id} readOnly value={lien} onFocus={e => e.currentTarget.select()} />
      <Button type="button" size="sm" variant="outline" onClick={copier}>{copie ? t('copie') : t('copier')}</Button>
    </div>
    <p className="text-sm text-muted-foreground">
      {echeance ? t('avertissementDate', { date: echeance }) : t('avertissementListe')}
    </p>
  </div>
}

function Retour({ etat, expireA }: { etat: EtatUtilisateurs; expireA?: string | null }) {
  return <>
    {etat.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
    {etat.succes && <p role="status" className="text-sm">{etat.succes}</p>}
    {etat.lien && <LienInvitation lien={etat.lien} expireA={etat.expireA ?? expireA} />}
  </>
}

export function FormulaireInvitation() {
  const t = useTranslations('ecrans.utilisateurs')
  const [etat, action] = useFormState(inviter, {})
  return <form action={action} className="space-y-3 rounded-md border p-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">{t('formulaire.email')}<Input name="email" type="email" autoComplete="off" required maxLength={254} /></label>
      <label className="flex flex-col gap-1 text-sm">{t('formulaire.role')}
        <select className={choix} name="role" defaultValue="Member">
          <option value="Member">{t('role.membre')}</option>
          <option value="TenantAdmin">{t('role.admin')}</option>
        </select>
      </label>
      <label className="block text-sm">{t('formulaire.prenom')}<Input name="prenom" autoComplete="off" required maxLength={80} /></label>
      <label className="block text-sm">{t('formulaire.nom')}<Input name="nom" autoComplete="off" required maxLength={80} /></label>
    </div>
    <Soumettre texte={t('formulaire.envoyer')} attente={t('formulaire.envoi')} />
    <Retour etat={etat} />
  </form>
}

/** Remonte l'état de l'action à la ligne pour l'afficher sous les boutons. */
function useRemonter(etat: EtatUtilisateurs, onEtat: (etat: EtatUtilisateurs) => void) {
  useEffect(() => {
    if (etat.erreur || etat.succes) onEtat(etat)
  }, [etat, onEtat])
}

/** Formulaire dont la soumission passe par une boîte de confirmation. */
function ActionConfirmee({ action, compte, role, bouton, titre, description, confirmation, variant = 'outline', onEtat }: {
  action: ActionServeur
  compte: string
  role?: string
  bouton: string
  titre: string
  description: ReactNode
  confirmation: string
  variant?: 'outline' | 'destructive'
  onEtat: (etat: EtatUtilisateurs) => void
}) {
  const formId = useId()
  const t = useTranslations('ecrans.utilisateurs.actions')
  const [etat, soumettre] = useFormState(action, {})
  useRemonter(etat, onEtat)
  return <>
    <form id={formId} action={soumettre}>
      <input type="hidden" name="compteId" value={compte} />
      {role && <input type="hidden" name="role" value={role} />}
    </form>
    <AlertDialog>
      <AlertDialogTrigger asChild><Button type="button" size="sm" variant={variant}>{bouton}</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titre}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('annuler')}</AlertDialogCancel>
          <AlertDialogAction type="submit" form={formId}>{confirmation}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}

function BoutonSimple({ texte, attente }: { texte: string; attente: string }) {
  const { pending } = useFormStatus()
  return <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? attente : texte}</Button>
}

function ActionSimple({ action, compte, email, bouton, attente, onEtat }: {
  action: ActionServeur
  compte: string
  email?: string
  bouton: string
  attente: string
  onEtat: (etat: EtatUtilisateurs) => void
}) {
  const [etat, soumettre] = useFormState(action, {})
  useRemonter(etat, onEtat)
  return <form action={soumettre}>
    <input type="hidden" name="compteId" value={compte} />
    {email && <input type="hidden" name="email" value={email} />}
    <BoutonSimple texte={bouton} attente={attente} />
  </form>
}

export function ActionsCompte({ compte, utilisateurCourantId }: { compte: CompteAffiche; utilisateurCourantId: string }) {
  const t = useTranslations('ecrans.utilisateurs.actions')
  const [retour, setRetour] = useState<EtatUtilisateurs>({})
  if (compte.id === utilisateurCourantId) {
    return <p className="text-sm text-muted-foreground">{t('propreCompte')}</p>
  }
  const nom = `${compte.prenom} ${compte.nom}`.trim() || compte.email
  const admin = compte.roleName === 'TenantAdmin'
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {compte.statut === 'invite' && <ActionSimple action={renvoyer} compte={compte.id} email={compte.email} bouton={t('renvoyer')} attente={t('renvoi')} onEtat={setRetour} />}
      {compte.statut === 'desactive' && <ActionSimple action={reactiver} compte={compte.id} bouton={t('reactiver')} attente={t('reactivation')} onEtat={setRetour} />}
      {compte.statut !== 'desactive' && <ActionConfirmee
        action={desactiver} compte={compte.id} bouton={t('desactiver')} variant="destructive" onEtat={setRetour}
        titre={t('desactiverTitre', { nom })}
        description={t('desactiverDescription')}
        confirmation={t('desactiverConfirmer')} />}
      <ActionConfirmee
        action={changerRole} compte={compte.id} role={admin ? 'Member' : 'TenantAdmin'} onEtat={setRetour}
        bouton={admin ? t('passerMembre') : t('passerAdmin')}
        titre={admin ? t('passerMembreTitre', { nom }) : t('passerAdminTitre', { nom })}
        description={admin ? t('passerMembreDescription') : t('passerAdminDescription')}
        confirmation={admin ? t('passerMembre') : t('passerAdmin')} />
    </div>
    <Retour etat={retour} expireA={compte.invitationExpireA} />
  </div>
}

function BadgeStatut({ compte }: { compte: CompteAffiche }) {
  const t = useTranslations('ecrans.utilisateurs.statut')
  const formaterDate = useFormaterDate()
  if (compte.statut === 'actif') return <Badge variant="success">{t('actif')}</Badge>
  if (compte.statut === 'desactive') return <Badge variant="secondary">{t('desactive')}</Badge>
  const date = formaterDate(compte.invitationExpireA)
  return <Badge variant="warning">{date ? t('inviteExpire', { date }) : t('invite')}</Badge>
}

export function ListeComptes({ comptes, utilisateurCourantId }: { comptes: CompteAffiche[]; utilisateurCourantId: string }) {
  const t = useTranslations('ecrans.utilisateurs')
  if (comptes.length === 0) return <p className="text-sm text-muted-foreground">{t('aucunCompte')}</p>
  return <ul className="divide-y rounded-md border">
    {comptes.map(c => <li key={c.id} className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {`${c.prenom} ${c.nom}`.trim() || c.email}
            {c.id === utilisateurCourantId && <span className="ms-2 text-sm font-normal text-muted-foreground">{t('vous')}</span>}
          </p>
          <p className="break-all text-sm text-muted-foreground">{c.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{c.roleName === 'TenantAdmin' ? t('role.admin') : t('role.membre')}</Badge>
          <BadgeStatut compte={c} />
          {c.oidc && <Badge variant="info">{t('connexionEntreprise')}</Badge>}
        </div>
      </div>
      <p className="text-sm">
        <span className="text-muted-foreground">{t('groupes')}</span>
        {c.groupes.length ? c.groupes.join(', ') : t('aucunGroupe')}
      </p>
      <ActionsCompte compte={c} utilisateurCourantId={utilisateurCourantId} />
    </li>)}
  </ul>
}
