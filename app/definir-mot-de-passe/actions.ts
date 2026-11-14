'use server'

import { redirect } from 'next/navigation'
import { definirMotDePasse, ErreurComptes } from '@/lib/auth/comptes'

export interface EtatDefinition {
  erreur?: string
}

/** L'état renvoyé ne contient jamais de mot de passe ni de jeton. */
export async function definirMotDePasseAction(_etat: EtatDefinition, formData: FormData): Promise<EtatDefinition> {
  const jeton = formData.get('jeton')
  const motDePasse = formData.get('motDePasse')
  const confirmation = formData.get('confirmation')
  if (typeof jeton !== 'string' || typeof motDePasse !== 'string' || typeof confirmation !== 'string') {
    return { erreur: 'Formulaire incomplet.' }
  }
  if (motDePasse !== confirmation) return { erreur: 'Les deux mots de passe ne sont pas identiques.' }
  try {
    await definirMotDePasse(jeton, motDePasse)
  } catch (erreur) {
    if (erreur instanceof ErreurComptes) return { erreur: erreur.message }
    console.error('[datagenius] comptes', { action: 'definition_mot_de_passe_erreur' })
    return { erreur: 'Impossible de définir le mot de passe. Réessayez.' }
  }
  redirect('/login?reinitialise=1')
}
