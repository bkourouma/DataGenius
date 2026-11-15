'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import {
  changerRoleCompte,
  desactiverCompte,
  ErreurComptes,
  inviterUtilisateur,
  reactiverCompte,
  renvoyerInvitation,
  type ResultatInvitation,
} from '@/lib/auth/comptes'
import { journal } from '@/lib/journal'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'

export type EtatUtilisateurs = { erreur?: string; succes?: string; lien?: string; expireA?: string }

const traduire = () => getTranslations('ecrans.utilisateurs.serveur')
type Traducteur = Awaited<ReturnType<typeof traduire>>

function texte(formulaire: FormData, nom: string): string {
  const valeur = formulaire.get(nom)
  return typeof valeur === 'string' ? valeur.trim() : ''
}

function erreurAffichable(erreur: unknown, t: Traducteur): EtatUtilisateurs {
  if (erreur instanceof ErreurComptes) return { erreur: erreur.message }
  // Pas d'e-mail ni de jeton dans les journaux : seulement le type d'erreur.
  journal.erreur('Gestion des utilisateurs : échec inattendu', { domaine: 'comptes', erreur: erreur instanceof Error ? erreur.name : typeof erreur })
  return { erreur: t('echec') }
}

function etatInvitation(resultat: ResultatInvitation, adresse: string, t: Traducteur): EtatUtilisateurs {
  return resultat.envoye
    ? { succes: t('invitationEnvoyee', { adresse }) }
    : { succes: t('courrierNonParti'), lien: resultat.lien, expireA: resultat.expireA?.toISOString() }
}

export async function inviter(_: EtatUtilisateurs, formulaire: FormData): Promise<EtatUtilisateurs> {
  const t = await traduire()
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: t('refus') }
  const email = texte(formulaire, 'email')
  try {
    const resultat = await inviterUtilisateur(acces.contexte.userId, {
      email,
      prenom: texte(formulaire, 'prenom'),
      nom: texte(formulaire, 'nom'),
      role: texte(formulaire, 'role'),
    })
    revalidatePath('/utilisateurs')
    return etatInvitation(resultat, email, t)
  } catch (erreur) {
    return erreurAffichable(erreur, t)
  }
}

export async function renvoyer(_: EtatUtilisateurs, formulaire: FormData): Promise<EtatUtilisateurs> {
  const t = await traduire()
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: t('refus') }
  try {
    const resultat = await renvoyerInvitation(acces.contexte.userId, texte(formulaire, 'compteId'))
    revalidatePath('/utilisateurs')
    return etatInvitation(resultat, texte(formulaire, 'email') || t('personneInvitee'), t)
  } catch (erreur) {
    return erreurAffichable(erreur, t)
  }
}

export async function desactiver(_: EtatUtilisateurs, formulaire: FormData): Promise<EtatUtilisateurs> {
  const t = await traduire()
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: t('refus') }
  try {
    await desactiverCompte(acces.contexte.userId, texte(formulaire, 'compteId'))
  } catch (erreur) {
    return erreurAffichable(erreur, t)
  }
  revalidatePath('/utilisateurs')
  return { succes: t('desactive') }
}

export async function reactiver(_: EtatUtilisateurs, formulaire: FormData): Promise<EtatUtilisateurs> {
  const t = await traduire()
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: t('refus') }
  try {
    await reactiverCompte(acces.contexte.userId, texte(formulaire, 'compteId'))
  } catch (erreur) {
    return erreurAffichable(erreur, t)
  }
  revalidatePath('/utilisateurs')
  return { succes: t('reactive') }
}

export async function changerRole(_: EtatUtilisateurs, formulaire: FormData): Promise<EtatUtilisateurs> {
  const t = await traduire()
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: t('refus') }
  try {
    await changerRoleCompte(acces.contexte.userId, texte(formulaire, 'compteId'), texte(formulaire, 'role'))
  } catch (erreur) {
    return erreurAffichable(erreur, t)
  }
  revalidatePath('/utilisateurs')
  return { succes: t('roleModifie') }
}
