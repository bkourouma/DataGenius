'use server'

import { revalidatePath } from 'next/cache'

import { journal } from '@/lib/journal'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { ajouterCommentaire, ErreurCommentaire, supprimerCommentaire } from './commentaires'

export type ResultatCommentaire =
  | { ok: true }
  | { erreur: 'introuvable' | 'invalide' | 'interdit' | 'limite_debit' | 'interne' }

function enErreur(erreur: unknown, action: string): ResultatCommentaire {
  if (erreur instanceof ErreurCommentaire) return { erreur: erreur.code }
  journal.erreur('Échec de l’action sur un commentaire', { action, erreur })
  return { erreur: 'interne' }
}

export async function ajouter(artefactId: string, texte: string): Promise<ResultatCommentaire> {
  const acces = await exigerMedicAssist()
  if (!acces.ok) return { erreur: 'introuvable' }
  try {
    await ajouterCommentaire(acces.contexte, String(artefactId), texte)
  } catch (erreur) {
    return enErreur(erreur, 'ajouter')
  }
  revalidatePath('/assistant/analyses/' + artefactId)
  return { ok: true }
}

export async function supprimer(commentaireId: string): Promise<ResultatCommentaire> {
  const acces = await exigerMedicAssist()
  if (!acces.ok) return { erreur: 'introuvable' }
  try {
    const { artefactId } = await supprimerCommentaire(acces.contexte, String(commentaireId))
    revalidatePath('/assistant/analyses/' + artefactId)
  } catch (erreur) {
    return enErreur(erreur, 'supprimer')
  }
  return { ok: true }
}
