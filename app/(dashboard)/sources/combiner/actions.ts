'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { creerCombinaison, modifierCombinaison, previsualiserCombinaison, supprimerCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { ErreurAdministrationSource } from '@/lib/warehouse/sources-admin'
import { ErreurDonnees } from '@/lib/medic-assist/donnees/types'
import { ErreurJointure } from '@/lib/warehouse/jointures'

export async function enregistrerCombinaison(_etat: { erreur?: string }, formulaire: FormData): Promise<{ erreur?: string }> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  try {
    const choix = formulaire.get('choix')
    if (typeof choix !== 'string' || choix.length > 10_000) return { erreur: 'Sélection invalide.' }
    const selection = JSON.parse(choix)
    if (formulaire.has('cle') || formulaire.has('revision')) {
      const cle = formulaire.get('cle')
      const revision = formulaire.get('revision')
      if (typeof cle !== 'string' || !/^combinaison_[0-9a-f]{32}$/.test(cle) ||
          typeof revision !== 'string' || !/^[0-9a-f]{64}$/.test(revision)) return { erreur: 'Édition invalide.' }
      await modifierCombinaison(cle, revision, selection)
    } else {
      await creerCombinaison({
        ...selection,
        titre: formulaire.get('titre'),
        description: formulaire.get('description'),
      })
    }
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurJointure ? erreur.message :
      'Vérifiez les colonnes de liaison et sélectionnez au moins une colonne à conserver.' }
  }
  revalidatePath('/sources')
  redirect('/sources#combinaisons')
}


export async function previsualiserJointure(choix: string) {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { erreur: 'Accès réservé aux administrateurs.' }
  if (typeof choix !== 'string' || choix.length > 10_000) return { erreur: 'Sélection invalide.' }
  try {
    return { resultat: await previsualiserCombinaison(JSON.parse(choix), garde.contexte) }
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurJointure || erreur instanceof ErreurDonnees ? erreur.message :
      'Aperçu indisponible. Vérifiez la sélection et l’état des imports, puis réessayez.' }
  }
}

export async function supprimerJeuCombine(_etat: { erreur?: string; succes?: string }, formulaire: FormData): Promise<{ erreur?: string; succes?: string }> {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return { erreur: 'Accès réservé aux administrateurs.' }
  const cle = formulaire.get('jeu')
  if (typeof cle !== 'string' || !/^combinaison_[0-9a-f]{32}$/.test(cle)) return { erreur: 'Jeu combiné introuvable.' }
  if (formulaire.get('confirmation') !== 'on') return { erreur: 'Cochez la case de confirmation pour supprimer le jeu combiné.' }
  try {
    await supprimerCombinaison(garde.contexte.userId, cle)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurAdministrationSource || erreur instanceof ErreurJointure ? erreur.message : 'Suppression impossible. Réessayez dans un instant.' }
  }
  revalidatePath('/sources')
  return { succes: 'Jeu combiné supprimé.' }
}
