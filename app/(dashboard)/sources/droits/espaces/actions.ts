'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { enregistrerEspace, ErreurEspace } from '@/lib/warehouse/espaces'
import { messageErreurLib } from '../../erreurs-lib'

type Etat = { erreur?: string; succes?: string }

export async function sauvegarderEspace(_: Etat, form: FormData): Promise<Etat> {
  const [t, commun] = await Promise.all([getTranslations('sources.espaces.actions'), getTranslations('sources.commun')])
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: commun('acces') }
  const id = form.get('id')
  try {
    await enregistrerEspace(acces.contexte.userId, typeof id === 'string' && id ? id : null, Number(form.get('version')), {
      nom: form.get('nom'), description: form.get('description'), groupes: form.getAll('groupes'), jeux: form.getAll('jeux'),
    })
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurEspace ? await messageErreurLib(erreur.message) : t('verifier') }
  }
  revalidatePath('/espaces')
  revalidatePath('/sources/droits/espaces')
  return { succes: t('enregistre') }
}
