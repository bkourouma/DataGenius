'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { enregistrerQualite } from '@/lib/warehouse/qualite-admin'
import { ErreurQualite } from '@/lib/warehouse/qualite'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'
import { messageErreurLib } from '../../erreurs-lib'

type Etat = { erreur?: string }

export async function enregistrer(cle: string, version: number, _etat: Etat, donnees: FormData): Promise<Etat> {
  const [t, commun] = await Promise.all([getTranslations('sources.qualite.actions'), getTranslations('sources.commun')])
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: commun('acces') }
  const definition = donnees.get('definition')
  if (typeof definition !== 'string' || definition.length > 30_000) return { erreur: t('configurationInvalide') }
  try {
    await enregistrerQualite(cle, version, JSON.parse(definition))
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurQualite ? await messageErreurLib(erreur.message) : t('nonEnregistree') }
  }
  revalidatePath('/sources')
  revalidatePath('/sources/qualite/' + cle)
  redirect('/sources/qualite/' + cle + '?etat=enregistre')
}

export async function relancer(cle: string, _etat: Etat, _donnees: FormData): Promise<Etat> {
  const [t, commun, actions] = await Promise.all([getTranslations('sources.qualite.actions'), getTranslations('sources.commun'), getTranslations('sources.actions')])
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: commun('acces') }
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(cle)) return { erreur: actions('importIntrouvable') }
  try {
    await synchroniserEntrepot({ jeu: cle, forcer: true })
  } catch {
    return { erreur: t('relanceImpossible') }
  }
  revalidatePath('/sources')
  revalidatePath('/sources/qualite/' + cle)
  redirect('/sources/qualite/' + cle)
}
