/**
 * Acces Prisma de la transcription (ecriture de l'usage, table AssistantUsage). SEUL fichier
 * du dossier qui touche la base. `conversationId` reste absent : une dictee precede le message.
 */

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'

export interface UsageTranscription {
  userId: string
  fournisseur: string
  modele: string
  tokensEntree: number
  tokensSortie: number
  coutUsd: number
  dureeMs: number
  /** Code court si l'appel a echoue (le cout est alors 0). */
  erreur?: string
}

/**
 * Enregistre l'usage d'une dictee. Echec silencieux : une erreur d'ecriture ne casse pas la
 * dictee, elle est journalisee sans donnee (ni texte, ni identifiant, ni message d'erreur).
 */
export async function enregistrerUsageTranscription(usage: UsageTranscription): Promise<void> {
  try {
    await prisma.assistantUsage.create({
      data: {
        userId: usage.userId,
        mode: 'transcription',
        fournisseur: usage.fournisseur,
        modele: usage.modele,
        tokensEntree: usage.tokensEntree,
        tokensSortie: usage.tokensSortie,
        coutUsd: new Prisma.Decimal(usage.erreur ? 0 : usage.coutUsd),
        dureeMs: usage.dureeMs,
        ...(usage.erreur ? { erreur: usage.erreur } : {}),
      },
    })
  } catch {
    console.error('[medic-assist] usage de transcription non enregistre')
  }
}
