'use server'

import { revalidatePath } from 'next/cache'
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

const REFUS = 'Accès réservé aux administrateurs.'
const ECHEC = 'Opération impossible pour le moment. Réessayez plus tard.'
const COURRIER_NON_PARTI =
  "Le courrier n'a pas pu être envoyé (SMTP non configuré ou en échec). Transmettez ce lien vous-même :"

function texte(formulaire: FormData, nom: string): string {
  const valeur = formulaire.get(nom)
  return typeof valeur === 'string' ? valeur.trim() : ''
}

function erreurAffichable(erreur: unknown): EtatUtilisateurs {
  if (erreur instanceof ErreurComptes) return { erreur: erreur.message }
  // Pas d'e-mail ni de jeton dans les journaux : seulement le type d'erreur.
  journal.erreur('Gestion des utilisateurs : échec inattendu', { domaine: 'comptes', erreur: erreur instanceof Error ? erreur.name : typeof erreur })
  return { erreur: ECHEC }
}

function etatInvitation(resultat: ResultatInvitation, adresse: string): EtatUtilisateurs {
  return resultat.envoye
    ? { succes: `Invitation envoyée à ${adresse}.` }
    : { succes: COURRIER_NON_PARTI, lien: resultat.lien, expireA: resultat.expireA?.toISOString() }
}

export async function inviter(_: EtatUtilisateurs, formulaire: FormData): Promise<EtatUtilisateurs> {
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: REFUS }
  const email = texte(formulaire, 'email')
  try {
    const resultat = await inviterUtilisateur(acces.contexte.userId, {
      email,
      prenom: texte(formulaire, 'prenom'),
      nom: texte(formulaire, 'nom'),
      role: texte(formulaire, 'role'),
    })
    revalidatePath('/utilisateurs')
    return etatInvitation(resultat, email)
  } catch (erreur) {
    return erreurAffichable(erreur)
  }
}

export async function renvoyer(_: EtatUtilisateurs, formulaire: FormData): Promise<EtatUtilisateurs> {
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: REFUS }
  try {
    const resultat = await renvoyerInvitation(acces.contexte.userId, texte(formulaire, 'compteId'))
    revalidatePath('/utilisateurs')
    return etatInvitation(resultat, texte(formulaire, 'email') || 'la personne invitée')
  } catch (erreur) {
    return erreurAffichable(erreur)
  }
}

export async function desactiver(_: EtatUtilisateurs, formulaire: FormData): Promise<EtatUtilisateurs> {
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: REFUS }
  try {
    await desactiverCompte(acces.contexte.userId, texte(formulaire, 'compteId'))
  } catch (erreur) {
    return erreurAffichable(erreur)
  }
  revalidatePath('/utilisateurs')
  return { succes: 'Compte désactivé.' }
}

export async function reactiver(_: EtatUtilisateurs, formulaire: FormData): Promise<EtatUtilisateurs> {
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: REFUS }
  try {
    await reactiverCompte(acces.contexte.userId, texte(formulaire, 'compteId'))
  } catch (erreur) {
    return erreurAffichable(erreur)
  }
  revalidatePath('/utilisateurs')
  return { succes: 'Compte réactivé.' }
}

export async function changerRole(_: EtatUtilisateurs, formulaire: FormData): Promise<EtatUtilisateurs> {
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: REFUS }
  try {
    await changerRoleCompte(acces.contexte.userId, texte(formulaire, 'compteId'), texte(formulaire, 'role'))
  } catch (erreur) {
    return erreurAffichable(erreur)
  }
  revalidatePath('/utilisateurs')
  return { succes: 'Rôle modifié.' }
}
