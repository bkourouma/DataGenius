'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { enregistrerAudit } from '@/lib/audit/enregistrer'
import { journal } from '@/lib/journal'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { dupliquerTableau, enregistrerTableau, ErreurTableau, ErreurVersionIncompatible, restaurerVersion, supprimerTableau } from '@/lib/warehouse/tableaux'
import { messageErreurTableau } from './erreurs-lib'

export async function enregistrer(edition: { id: string; version: number } | null, _etat: { erreur?: string }, formulaire: FormData): Promise<{ erreur?: string }> {
  const acces = await exigerMedicAssist()
  const t = await getTranslations('tableaux.actions')
  if (!acces.ok) return { erreur: t('sessionExpiree') }
  const donnees = formulaire.get('configuration')
  if (typeof donnees !== 'string' || donnees.length > 16000) return { erreur: t('configurationInvalide') }
  let id: string
  try {
    id = await enregistrerTableau(acces.contexte, { ...JSON.parse(donnees), titre: formulaire.get('titre') }, edition ?? undefined)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurTableau ? await messageErreurTableau(erreur.message) : t('enregistrementImpossible') }
  }
  revalidatePath('/tableaux')
  revalidatePath(`/tableaux/${id}`)
  redirect(`/tableaux/${id}`)
}

type EtatAction = { erreur?: string; succes?: string }

export async function dupliquer(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const acces = await exigerMedicAssist()
  const t = await getTranslations('tableaux.actions')
  if (!acces.ok) return { erreur: t('sessionExpiree') }
  const id = formulaire.get('id')
  if (typeof id !== 'string' || !id || id.length > 64) return { erreur: t('tableauIntrouvable') }
  let copie: string
  try {
    copie = await dupliquerTableau(acces.contexte, id)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurTableau ? await messageErreurTableau(erreur.message) : t('duplicationImpossible') }
  }
  await enregistrerAudit({ acteurId: acces.contexte.userId, action: 'tableau.duplication', cible: { type: 'tableau', id: copie }, details: { origine: id } })
  revalidatePath('/tableaux')
  redirect(`/tableaux/${copie}`)
}

export async function supprimer(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const acces = await exigerMedicAssist()
  const t = await getTranslations('tableaux.actions')
  if (!acces.ok) return { erreur: t('sessionExpiree') }
  const id = formulaire.get('id')
  if (typeof id !== 'string' || !id || id.length > 64) return { erreur: t('tableauIntrouvable') }
  if (formulaire.get('confirmation') !== 'on') return { erreur: t('confirmationRequise') }
  try {
    await supprimerTableau(acces.contexte, id)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurTableau ? await messageErreurTableau(erreur.message) : t('suppressionImpossible') }
  }
  await enregistrerAudit({ acteurId: acces.contexte.userId, action: 'tableau.suppression', cible: { type: 'tableau', id } })
  revalidatePath('/tableaux')
  redirect('/tableaux')
}

export async function restaurer(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const acces = await exigerMedicAssist()
  const t = await getTranslations('tableaux.actions')
  if (!acces.ok) return { erreur: t('sessionExpiree') }
  const id = formulaire.get('id')
  if (typeof id !== 'string' || !id || id.length > 64) return { erreur: t('tableauIntrouvable') }
  const version = Number(formulaire.get('version'))
  const versionCourante = Number(formulaire.get('versionCourante'))
  if (!Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(versionCourante) || versionCourante < 1) {
    return { erreur: t('versionIntrouvable') }
  }
  try {
    await restaurerVersion(acces.contexte, id, version, versionCourante)
  } catch (erreur) {
    const th = await getTranslations('historique')
    if (erreur instanceof ErreurVersionIncompatible) return { erreur: th('erreurIncompatible') }
    if (erreur instanceof ErreurTableau) return { erreur: await messageErreurTableau(erreur.message) }
    journal.erreur('Restauration de version impossible', { domaine: 'tableaux', erreur: erreur instanceof Error ? erreur.name : 'inconnue' })
    return { erreur: th('erreurGenerique') }
  }
  await enregistrerAudit({ acteurId: acces.contexte.userId, action: 'tableau.restauration', cible: { type: 'tableau', id }, details: { version, versionCourante } })
  revalidatePath('/tableaux')
  revalidatePath(`/tableaux/${id}`)
  revalidatePath(`/tableaux/${id}/historique`)
  redirect(`/tableaux/${id}`)
}
