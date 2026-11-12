'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { enregistrerTableau, ErreurTableau } from '@/lib/warehouse/tableaux'

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
