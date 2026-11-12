'use server'

import { revalidatePath } from 'next/cache'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { enregistrerEspace, ErreurEspace } from '@/lib/warehouse/espaces'

type Etat = { erreur?: string; succes?: string }

export async function sauvegarderEspace(_: Etat, form: FormData): Promise<Etat> {
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) return { erreur: 'Accès réservé aux administrateurs.' }
  const id = form.get('id')
  try {
    await enregistrerEspace(acces.contexte.userId, typeof id === 'string' && id ? id : null, Number(form.get('version')), {
      nom: form.get('nom'), description: form.get('description'), groupes: form.getAll('groupes'), jeux: form.getAll('jeux'),
    })
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurEspace ? erreur.message : 'Vérifiez le nom et la sélection.' }
  }
  revalidatePath('/espaces')
  revalidatePath('/sources/droits/espaces')
  return { succes: 'Espace enregistré.' }
}
