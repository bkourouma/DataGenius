'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { enregistrerQualite } from '@/lib/warehouse/qualite-admin'
import { ErreurQualite } from '@/lib/warehouse/qualite'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'

type Etat = { erreur?: string }

export async function enregistrer(cle: string, version: number, _etat: Etat, donnees: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  const definition = donnees.get('definition')
  if (typeof definition !== 'string' || definition.length > 30_000) return { erreur: 'Configuration invalide.' }
  try {
    await enregistrerQualite(cle, version, JSON.parse(definition))
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurQualite ? erreur.message : 'Configuration non enregistrée. Rechargez la page, puis réessayez.' }
  }
  revalidatePath('/sources')
  revalidatePath('/sources/qualite/' + cle)
  redirect('/sources/qualite/' + cle + '?etat=enregistre')
}

export async function relancer(cle: string, _etat: Etat, _donnees: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(cle)) return { erreur: 'Import introuvable.' }
  try {
    await synchroniserEntrepot({ jeu: cle, forcer: true })
  } catch {
    return { erreur: 'La synchronisation n’a pas pu être relancée.' }
  }
  revalidatePath('/sources')
  revalidatePath('/sources/qualite/' + cle)
  redirect('/sources/qualite/' + cle)
}
