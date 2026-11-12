'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { ErreurIncrementale } from '@/lib/warehouse/incremental'
import { chargerIncremental, enregistrerIncremental } from '@/lib/warehouse/incremental-admin'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'

type Etat = { erreur?: string }

export async function enregistrer(cle: string, version: number, _etat: Etat, donnees: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(cle)) return { erreur: 'Import introuvable.' }
  const entier = (nom: string) => {
    const valeur = donnees.get(nom)
    return typeof valeur === 'string' && /^\d+$/.test(valeur) ? Number(valeur) : NaN
  }
  try {
    await enregistrerIncremental(cle, version, donnees.get('mode') === 'desactiver' ? null : {
      cles: donnees.getAll('cles'),
      dateModification: donnees.get('dateModification'),
      chevauchementMinutes: entier('chevauchementMinutes'),
      reconciliationMinutes: entier('reconciliationMinutes'),
    })
  } catch (erreur) {
    return { erreur: erreur instanceof ErreurIncrementale ? erreur.message :
      'Configuration non enregistrée. Rechargez la page puis réessayez.' }
  }
  revalidatePath('/sources/qualite/' + cle)
  redirect('/sources/incremental/' + cle + '?etat=enregistre')
}

export async function relancer(cle: string, _etat: Etat, donnees: FormData): Promise<Etat> {
  if (!(await exigerAdminMedicAssist()).ok) return { erreur: 'Accès réservé aux administrateurs.' }
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(cle)) return { erreur: 'Import introuvable.' }
  let statut: string
  try {
    if (!(await chargerIncremental(cle))?.etat) return { erreur: 'Activez le mode incrémental pour cet import.' }
    const [resultat] = await synchroniserEntrepot({ jeu: cle, forcer: true, reconcilier: donnees.get('mode') === 'reconcilier' })
    statut = resultat?.statut ?? 'echec'
  } catch {
    statut = 'echec'
  }
  revalidatePath('/sources')
  revalidatePath('/sources/qualite/' + cle)
  redirect('/sources/incremental/' + cle + '?etat=' + statut)
}
