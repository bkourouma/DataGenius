'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { journal } from '@/lib/journal'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { dupliquerTableau, enregistrerTableau, ErreurTableau, ErreurVersionIncompatible, restaurerVersion, supprimerTableau } from '@/lib/warehouse/tableaux'

export async function enregistrer(edition: { id: string; version: number } | null, _etat: { erreur?: string }, formulaire: FormData): Promise<{ erreur?: string }> {
  const acces = await exigerMedicAssist()
  if (!acces.ok) return { erreur: 'Session expirée. Reconnectez-vous.' }
  const donnees = formulaire.get('configuration')
  if (typeof donnees !== 'string' || donnees.length > 16000) return { erreur: 'Configuration du tableau invalide.' }
  let id: string
  try {
    id = await enregistrerTableau(acces.contexte, { ...JSON.parse(donnees), titre: formulaire.get('titre') }, edition ?? undefined)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurTableau ? erreur.message : 'Enregistrement impossible.' }
  }
  revalidatePath('/tableaux')
  revalidatePath(`/tableaux/${id}`)
  redirect(`/tableaux/${id}`)
}

type EtatAction = { erreur?: string; succes?: string }

export async function dupliquer(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const acces = await exigerMedicAssist()
  if (!acces.ok) return { erreur: 'Session expirée. Reconnectez-vous.' }
  const id = formulaire.get('id')
  if (typeof id !== 'string' || !id || id.length > 64) return { erreur: 'Tableau introuvable.' }
  let copie: string
  try {
    copie = await dupliquerTableau(acces.contexte, id)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurTableau ? erreur.message : 'Duplication impossible.' }
  }
  revalidatePath('/tableaux')
  redirect(`/tableaux/${copie}`)
}

export async function supprimer(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const acces = await exigerMedicAssist()
  if (!acces.ok) return { erreur: 'Session expirée. Reconnectez-vous.' }
  const id = formulaire.get('id')
  if (typeof id !== 'string' || !id || id.length > 64) return { erreur: 'Tableau introuvable.' }
  if (formulaire.get('confirmation') !== 'on') return { erreur: 'Cochez la case de confirmation pour supprimer le tableau.' }
  try {
    await supprimerTableau(acces.contexte, id)
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurTableau ? erreur.message : 'Suppression impossible.' }
  }
  revalidatePath('/tableaux')
  redirect('/tableaux')
}

export async function restaurer(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const acces = await exigerMedicAssist()
  if (!acces.ok) return { erreur: 'Session expirée. Reconnectez-vous.' }
  const id = formulaire.get('id')
  if (typeof id !== 'string' || !id || id.length > 64) return { erreur: 'Tableau introuvable.' }
  const version = Number(formulaire.get('version'))
  const versionCourante = Number(formulaire.get('versionCourante'))
  if (!Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(versionCourante) || versionCourante < 1) {
    return { erreur: 'Version introuvable.' }
  }
  try {
    await restaurerVersion(acces.contexte, id, version, versionCourante)
  } catch (erreur) {
    const t = await getTranslations('historique')
    if (erreur instanceof ErreurVersionIncompatible) return { erreur: t('erreurIncompatible') }
    if (erreur instanceof ErreurTableau) return { erreur: erreur.message }
    journal.erreur('Restauration de version impossible', { domaine: 'tableaux', erreur: erreur instanceof Error ? erreur.name : 'inconnue' })
    return { erreur: t('erreurGenerique') }
  }
  revalidatePath('/tableaux')
  revalidatePath(`/tableaux/${id}`)
  revalidatePath(`/tableaux/${id}/historique`)
  redirect(`/tableaux/${id}`)
}
