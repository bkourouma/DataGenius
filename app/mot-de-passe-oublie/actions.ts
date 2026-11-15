'use server'

import { getTranslations } from 'next-intl/server'
import { demanderReinitialisation } from '@/lib/auth/comptes'
import { journal } from '@/lib/journal'

export interface EtatDemande {
  confirmation?: string
}

/** Réponse toujours identique : rien ne révèle si le compte existe, ni si l'envoi a échoué. */
export async function demanderLienAction(_etat: EtatDemande, formData: FormData): Promise<EtatDemande> {
  const t = await getTranslations('ecrans.motDePasseOublie')
  const email = formData.get('email')
  try {
    if (typeof email === 'string') await demanderReinitialisation(email.slice(0, 254))
  } catch {
    journal.erreur('Échec de la demande de réinitialisation', { domaine: 'comptes', action: 'reinitialisation_erreur' })
  }
  return { confirmation: t('confirmation') }
}
