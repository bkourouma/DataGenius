'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { creerCombinaison, modifierCombinaison, previsualiserCombinaison, supprimerCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { ErreurAdministrationSource } from '@/lib/warehouse/sources-admin'
import { ErreurDonnees } from '@/lib/medic-assist/donnees/types'
import { ErreurJointure } from '@/lib/warehouse/jointures'
import { getTranslations } from 'next-intl/server'
import { messageErreurLib } from '../erreurs-lib'

export async function enregistrerCombinaison(_etat: { erreur?: string }, formulaire: FormData): Promise<{ erreur?: string }> {
  const t = await getTranslations('sources.combiner.actions')
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  try {
    const choix = formulaire.get('choix')
    if (typeof choix !== 'string' || choix.length > 10_000) return { erreur: t('selectionInvalide') }
    const selection = JSON.parse(choix)
    if (formulaire.has('cle') || formulaire.has('revision')) {
      const cle = formulaire.get('cle')
      const revision = formulaire.get('revision')
      if (typeof cle !== 'string' || !/^combinaison_[0-9a-f]{32}$/.test(cle) ||
          typeof revision !== 'string' || !/^[0-9a-f]{64}$/.test(revision)) return { erreur: t('editionInvalide') }
      await modifierCombinaison(cle, revision, selection)
    } else {
      await creerCombinaison({
        ...selection,
        titre: formulaire.get('titre'),
        description: formulaire.get('description'),
      })
    }
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurJointure ? await messageErreurLib(erreur.message) : t('verifierLiaisons') }
  }
  revalidatePath('/sources')
  redirect('/sources#combinaisons')
}


export async function previsualiserJointure(choix: string) {
  const garde = await exigerAdminMedicAssist()
  const t = await getTranslations('sources.combiner.actions')
  if (!garde.ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  if (typeof choix !== 'string' || choix.length > 10_000) return { erreur: t('selectionInvalide') }
  try {
    return { resultat: await previsualiserCombinaison(JSON.parse(choix), garde.contexte) }
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurJointure || erreur instanceof ErreurDonnees ? await messageErreurLib(erreur.message) : t('apercuIndisponible') }
  }
}

export async function supprimerJeuCombine(_etat: { erreur?: string; succes?: string }, formulaire: FormData): Promise<{ erreur?: string; succes?: string }> {
  const garde = await exigerAdminMedicAssist()
  const t = await getTranslations('sources.combiner.actions')
  if (!garde.ok) return { erreur: (await getTranslations('sources.commun'))('acces') }
  const cle = formulaire.get('jeu')
  if (typeof cle !== 'string' || !/^combinaison_[0-9a-f]{32}$/.test(cle)) return { erreur: t('jeuIntrouvable') }
  if (formulaire.get('confirmation') !== 'on') return { erreur: t('confirmerSuppression') }
  try {
    await supprimerCombinaison(garde.contexte.userId, cle)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurAdministrationSource || erreur instanceof ErreurJointure ? await messageErreurLib(erreur.message) : t('suppressionImpossible') }
  }
  revalidatePath('/sources')
  return { succes: t('supprime') }
}
