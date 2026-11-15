'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CompteListe } from '@/lib/auth/comptes'
import { changerRole, desactiver, inviter, reactiver, renvoyer, type EtatUtilisateurs } from './actions'

export type CompteAffiche = Omit<CompteListe, 'invitationExpireA'> & { invitationExpireA: string | null }
type ActionServeur = (etat: EtatUtilisateurs, formulaire: FormData) => Promise<EtatUtilisateurs>

const choix = 'min-h-10 rounded-md border border-input bg-background px-3 text-sm [@media(pointer:coarse)]:min-h-11'
const dateCourte = new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })

function formaterDate(iso: string | null): string | null {
  return iso ? `${dateCourte.format(new Date(iso))} UTC` : null
}

function libelleRole(role: string) {
  return role === 'TenantAdmin' ? 'Administrateur' : 'Membre'
}

function Soumettre({ texte, attente }: { texte: string; attente: string }) {
  const { pending } = useFormStatus()
  return <Button type="submit" size="sm" disabled={pending}>{pending ? attente : texte}</Button>
}

export function LienInvitation({ lien, expireA }: { lien: string; expireA?: string | null }) {
  const [copie, setCopie] = useState(false)
  const id = useId()
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
    <label htmlFor={id} className="block text-sm font-medium">Lien d’invitation</label>
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input id={id} readOnly value={lien} onFocus={e => e.currentTarget.select()} />
      <Button type="button" size="sm" variant="outline" onClick={copier}>{copie ? 'Copié' : 'Copier'}</Button>
    </div>
    <p className="text-sm text-muted-foreground">
      Ce lien donne accès à la création du mot de passe : ne le partagez qu’avec la personne invitée ; il expire à la date indiquée{echeance ? ` (${echeance})` : ' dans la liste des comptes'}.
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
  const [etat, action] = useFormState(inviter, {})
  return <form action={action} className="space-y-3 rounded-md border p-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">Adresse e-mail<Input name="email" type="email" autoComplete="off" required maxLength={254} /></label>
      <label className="flex flex-col gap-1 text-sm">Rôle
        <select className={choix} name="role" defaultValue="Member">
          <option value="Member">Membre</option>
          <option value="TenantAdmin">Administrateur</option>
        </select>
      </label>
      <label className="block text-sm">Prénom<Input name="prenom" autoComplete="off" required maxLength={80} /></label>
      <label className="block text-sm">Nom<Input name="nom" autoComplete="off" required maxLength={80} /></label>
    </div>
    <Soumettre texte="Envoyer l’invitation" attente="Envoi…" />
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
          <AlertDialogCancel>Annuler</AlertDialogCancel>
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
  const [retour, setRetour] = useState<EtatUtilisateurs>({})
  if (compte.id === utilisateurCourantId) {
    return <p className="text-sm text-muted-foreground">Vous ne pouvez pas modifier votre propre compte ici.</p>
  }
  const nom = `${compte.prenom} ${compte.nom}`.trim() || compte.email
  const admin = compte.roleName === 'TenantAdmin'
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {compte.statut === 'invite' && <ActionSimple action={renvoyer} compte={compte.id} email={compte.email} bouton="Renvoyer l’invitation" attente="Renvoi…" onEtat={setRetour} />}
      {compte.statut === 'desactive' && <ActionSimple action={reactiver} compte={compte.id} bouton="Réactiver" attente="Réactivation…" onEtat={setRetour} />}
      {compte.statut !== 'desactive' && <ActionConfirmee
        action={desactiver} compte={compte.id} bouton="Désactiver" variant="destructive" onEtat={setRetour}
        titre={`Désactiver ${nom} ?`}
        description="Cette personne ne pourra plus se connecter. Ses données sont conservées. Vous pourrez réactiver le compte plus tard."
        confirmation="Désactiver le compte" />}
      <ActionConfirmee
        action={changerRole} compte={compte.id} role={admin ? 'Member' : 'TenantAdmin'} onEtat={setRetour}
        bouton={admin ? 'Passer membre' : 'Passer administrateur'}
        titre={admin ? `Passer ${nom} en membre ?` : `Passer ${nom} administrateur ?`}
        description={admin
          ? 'Cette personne perdra l’accès à l’administration (utilisateurs, sources, paramètres) et ne verra plus que les données autorisées à ses groupes.'
          : 'Cette personne pourra gérer les utilisateurs, les sources et les paramètres, et verra toutes les données.'}
        confirmation={admin ? 'Passer membre' : 'Passer administrateur'} />
    </div>
    <Retour etat={retour} expireA={compte.invitationExpireA} />
  </div>
}

function BadgeStatut({ compte }: { compte: CompteAffiche }) {
  if (compte.statut === 'actif') return <Badge variant="success">Actif</Badge>
  if (compte.statut === 'desactive') return <Badge variant="secondary">Désactivé</Badge>
  const date = formaterDate(compte.invitationExpireA)
  return <Badge variant="warning">Invité{date ? ` · expire le ${date}` : ''}</Badge>
}

export function ListeComptes({ comptes, utilisateurCourantId }: { comptes: CompteAffiche[]; utilisateurCourantId: string }) {
  if (comptes.length === 0) return <p className="text-sm text-muted-foreground">Aucun compte.</p>
  return <ul className="divide-y rounded-md border">
    {comptes.map(c => <li key={c.id} className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {`${c.prenom} ${c.nom}`.trim() || c.email}
            {c.id === utilisateurCourantId && <span className="ml-2 text-sm font-normal text-muted-foreground">(Vous)</span>}
          </p>
          <p className="break-all text-sm text-muted-foreground">{c.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{libelleRole(c.roleName)}</Badge>
          <BadgeStatut compte={c} />
          {c.oidc && <Badge variant="info">Connexion entreprise</Badge>}
        </div>
      </div>
      <p className="text-sm">
        <span className="text-muted-foreground">Groupes : </span>
        {c.groupes.length ? c.groupes.join(', ') : 'Aucun groupe'}
      </p>
      <ActionsCompte compte={c} utilisateurCourantId={utilisateurCourantId} />
    </li>)}
  </ul>
}
