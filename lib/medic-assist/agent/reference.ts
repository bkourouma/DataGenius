/**
 * Référence courte d'un incident, citable par l'utilisateur au support (ex. `DG-7K3F9Q`).
 * Alphabet de 32 symboles sans ambiguïté (ni 0/O, ni 1/I) : un octet aléatoire masqué sur
 * 5 bits ne crée aucun biais. Aucune donnée de l'utilisateur n'y entre.
 */

import { randomBytes } from 'node:crypto'

export const ALPHABET_REFERENCE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const FORMAT_REFERENCE = /^DG-[A-HJ-NP-Z2-9]{6}$/

export function genererReference(): string {
  const octets = randomBytes(6)
  let code = ''
  for (const octet of octets) code += ALPHABET_REFERENCE[octet & 31]
  return `DG-${code}`
}
