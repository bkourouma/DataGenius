'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'
import {
  ajouterSource,
  creerImport,
  modifierFrequence,
  ErreurAdministrationSource,
} from '@/lib/warehouse/sources-admin'

type Etat = { erreur?: string; succes?: string }

export async function ajouterConnexion(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  let id: string
  try {
    id = await ajouterSource({
      titre: formulaire.get('titre'), hote: formulaire.get('hote'), port: formulaire.get('port'),
      base: formulaire.get('base'), utilisateur: formulaire.get('utilisateur'),
      motDePasse: formulaire.get('motDePasse'), tls: formulaire.get('tls'),
    })
  } catch {
    return { erreur: 'Connexion impossible. Vérifiez les paramètres, le compte de lecture et la configuration du serveur.' }
  }
  revalidatePath('/sources')
  redirect('/sources/' + id)
}

export async function ajouterImport(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  try {
    await creerImport({
      sourceId: formulaire.get('sourceId'), schema: formulaire.get('schema'), table: formulaire.get('table'),
      titre: formulaire.get('titre'), description: formulaire.get('description'), colonnes: formulaire.getAll('colonnes'),
      frequenceMinutes: formulaire.get('frequenceMinutes'),
    })
  } catch (erreur) {
    return {
      erreur: erreur instanceof ErreurAdministrationSource ? erreur.message :
        'Import non enregistré. Sélectionnez entre 1 et 50 colonnes accessibles et une fréquence valide.',
    }
  }
  revalidatePath('/sources')
  redirect('/sources')
}

export async function changerFrequence(_etat: Etat, formulaire: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  try {
    const cle = formulaire.get('jeu')
    if (typeof cle !== 'string') return { erreur: 'Import introuvable.' }
    await modifierFrequence(cle, formulaire.get('frequenceMinutes'))
  } catch {
    return { erreur: 'Fréquence non enregistrée. Indiquez de 1 à 10 080 minutes.' }
  }
  revalidatePath('/sources')
  return { succes: 'Fréquence enregistrée.' }
}

export async function actualiserJeu(formulaire: FormData) {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return
  const jeu = formulaire.get('jeu')
  if (typeof jeu !== 'string' || !/^[a-z][a-z0-9_]{0,59}$/.test(jeu)) return
  await synchroniserEntrepot({ forcer: true, jeu })
  revalidatePath('/sources')
}
