/**
 * Limite de débit de la transcription : 20 dictées par tranche glissante de 10 minutes et par
 * utilisateur. Limiteur en mémoire du processus (voir donnees/limite-debit.ts), instance
 * conservée sur globalThis comme les autres.
 */

import { LimiteurDebit, type ReglageLimite } from '@/lib/medic-assist/donnees/limite-debit'

export const LIMITE_TRANSCRIPTIONS: ReglageLimite = { max: 20, fenetreMs: 10 * 60 * 1000 }

const global = globalThis as unknown as { __medicAssistLimiteTranscription?: LimiteurDebit }

export function limiteurTranscription(): LimiteurDebit {
  global.__medicAssistLimiteTranscription ??= new LimiteurDebit(LIMITE_TRANSCRIPTIONS)
  return global.__medicAssistLimiteTranscription
}

/** Remet le limiteur à zéro (tests). */
export function reinitialiserLimiteurTranscription(): void {
  delete global.__medicAssistLimiteTranscription
}
