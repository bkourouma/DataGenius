'use server'

import { revalidatePath } from 'next/cache'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { creerGroupe, ErreurDroits, modifierGroupe, modifierRegle } from '@/lib/warehouse/droits-admin'

type Etat = { erreur?: string; succes?: string }

async function appliquer(traiter: (acteur: string) => Promise<void>): Promise<Etat> {
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: 'Accès réservé aux administrateurs.' }
  try {
    await traiter(acces.contexte.userId)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurDroits ? erreur.message : 'Enregistrement impossible. Vérifiez les valeurs saisies.' }
  }
  revalidatePath('/sources/droits')
  return { succes: 'Modifications enregistrées.' }
}

export async function ajouterGroupe(_: Etat, formulaire: FormData) {
  return appliquer(async acteur => { await creerGroupe(acteur, formulaire.get('nom')) })
}

export async function enregistrerGroupe(_: Etat, formulaire: FormData) {
  return appliquer(acteur => modifierGroupe(acteur, formulaire.get('id'), formulaire.get('nom'), formulaire.getAll('membres')))
}

export async function enregistrerRegle(_: Etat, formulaire: FormData) {
  const mode = formulaire.get('mode')
  const colonne = formulaire.get('filtreColonne')
  return appliquer(async acteur => {
    if (mode !== 'ouvert' && mode !== 'restreint') throw new ErreurDroits('Sélectionnez un mode d’accès.')
    const definition = mode === 'ouvert' ? null : {
      groupes: formulaire.getAll('groupes'),
      masquer: formulaire.getAll('masquer'),
      filtre: colonne ? { colonne, valeur: formulaire.get('filtreValeur') } : null,
    }
    await modifierRegle(acteur, formulaire.get('jeu'), definition)
  })
}
