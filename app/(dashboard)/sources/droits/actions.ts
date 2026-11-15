'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { creerGroupe, ErreurDroits, modifierGroupe, modifierRegle } from '@/lib/warehouse/droits-admin'
import { messageErreurLib } from '../erreurs-lib'

type Etat = { erreur?: string; succes?: string }

/** Erreur locale à l'écran (mode d'accès non choisi) : son texte est traduit ici, pas par messageErreurLib. */
class ErreurModeAcces extends Error {}

async function appliquer(traiter: (acteur: string) => Promise<void>): Promise<Etat> {
  const [t, commun] = await Promise.all([getTranslations('sources.droits.actions'), getTranslations('sources.commun')])
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: commun('acces') }
  try {
    await traiter(acces.contexte.userId)
  } catch (erreur) {
    if (erreur instanceof ErreurModeAcces) return { erreur: t('modeInvalide') }
    return { erreur: erreur instanceof ErreurDroits ? await messageErreurLib(erreur.message) : t('enregistrementImpossible') }
  }
  revalidatePath('/sources/droits')
  return { succes: t('enregistre') }
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
    if (mode !== 'ouvert' && mode !== 'restreint') throw new ErreurModeAcces()
    const definition = mode === 'ouvert' ? null : {
      groupes: formulaire.getAll('groupes'),
      masquer: formulaire.getAll('masquer'),
      filtre: colonne ? { colonne, valeur: formulaire.get('filtreValeur') } : null,
    }
    await modifierRegle(acteur, formulaire.get('jeu'), definition)
  })
}
