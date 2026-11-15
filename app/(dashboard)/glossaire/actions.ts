'use server'

import { revalidatePath } from 'next/cache'
import { enregistrerComplementGlossaire, ErreurGlossaire } from '@/lib/glossaire/complement'
import { journal } from '@/lib/journal'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'

/** Code d'erreur traduit côté client (clé `page.erreurs.<code>`). */
export type EtatComplement = { erreur?: 'session' | 'interdit' | 'introuvable' | 'invalide' | 'echec'; succes?: boolean }

export async function enregistrerComplement(_etat: EtatComplement, formulaire: FormData): Promise<EtatComplement> {
  const acces = await exigerMedicAssist()
  if (!acces.ok) return { erreur: 'session' }
  const jeu = formulaire.get('jeu')
  const indicateur = formulaire.get('indicateur')
  const definition = formulaire.get('definition')
  const synonymes = formulaire.get('synonymes')
  if (typeof jeu !== 'string' || typeof indicateur !== 'string' || typeof definition !== 'string' || typeof synonymes !== 'string') {
    return { erreur: 'invalide' }
  }
  try {
    await enregistrerComplementGlossaire(acces.contexte, {
      jeu,
      indicateur,
      definition,
      // Un synonyme par ligne ; les lignes vides sont ignorées.
      synonymes: synonymes.split(/\r?\n/).map(ligne => ligne.trim()).filter(Boolean),
    })
  } catch (erreur) {
    if (erreur instanceof ErreurGlossaire) return { erreur: erreur.code }
    journal.erreur('Enregistrement du complément du glossaire impossible', {
      domaine: 'glossaire',
      erreur: erreur instanceof Error ? erreur.name : 'inconnue',
    })
    return { erreur: 'echec' }
  }
  revalidatePath('/glossaire')
  return { succes: true }
}
