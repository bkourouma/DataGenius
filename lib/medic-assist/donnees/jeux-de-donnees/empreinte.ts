/**
 * Empreinte du périmètre d'un lecteur : le cache d'un jeu n'est réutilisé que si elle est
 * identique à celle enregistrée au calcul (même lecteur, même périmètre).
 */

import { createHash } from 'node:crypto'

import type { ContexteExecution } from '@/lib/medic-assist/contrats'

export function empreintePerimetre(contexte: Pick<ContexteExecution, 'userId' | 'scope'>): string {
  const forme = JSON.stringify({
    voitTout: contexte.scope.voitTout === true,
    userId: contexte.userId,
  })
  return createHash('sha256').update(forme).digest('hex')
}
