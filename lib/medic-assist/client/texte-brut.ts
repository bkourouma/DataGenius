/**
 * Conversion d'un markdown de reponse en texte brut (copie dans le presse-papiers,
 * lecture vocale). Pur, sans dependance : traitement ligne a ligne, expressions
 * regulieres a classes bornees (pas de retour arriere catastrophique).
 */

import type { MessageUI } from './types'

const LIGNE_SEPARATEUR_CELLULE = /^:?-+:?$/

function estSeparateurTableau(ligne: string): boolean {
  if (!ligne.includes('-')) return false
  const cellules = ligne
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
  if (cellules.length === 0) return false
  return cellules.every((c) => LIGNE_SEPARATEUR_CELLULE.test(c))
}

function cellulesDe(ligne: string): string[] {
  return ligne
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function nettoyerInline(texte: string): string {
  return texte
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1$2')
}

export function markdownVersTexte(md: string): string {
  if (!md) return ''
  const lignes = md.replace(/\r\n?/g, '\n').split('\n')
  const sortie: string[] = []
  let dansCode = false
  let dansTableau = false

  for (let i = 0; i < lignes.length; i++) {
    const brute = lignes[i]

    if (/^\s*(```|~~~)/.test(brute)) {
      dansCode = !dansCode
      continue
    }
    if (dansCode) {
      sortie.push(brute)
      continue
    }

    // Tableau GFM : l'en-tete est reconnu grace a la ligne de separation qui suit.
    if (!dansTableau && brute.includes('|') && i + 1 < lignes.length && estSeparateurTableau(lignes[i + 1])) {
      dansTableau = true
    }
    if (dansTableau) {
      if (!brute.includes('|') || brute.trim() === '') {
        dansTableau = false
      } else if (estSeparateurTableau(brute)) {
        continue
      } else {
        sortie.push(cellulesDe(brute).map(nettoyerInline).join(', '))
        continue
      }
    }

    // Filet horizontal.
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(brute)) continue

    const ligne = brute
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/\s+#+\s*$/, '')
      .replace(/^\s*>+\s?/, '')
      .replace(/^\s*[-*+]\s+/, '')
    sortie.push(nettoyerInline(ligne).replace(/[ \t]+$/g, ''))
  }

  return sortie
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const LONGUEUR_MIN_DEDOUBLONNAGE = 20

function normaliserTexte(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim()
}

/**
 * Parties d'un message sans les parties `text` repetees : un texte identique (espaces
 * normalises) a celui d'une partie texte precedente du meme message est retire. Les
 * textes de moins de 20 caracteres et les textes differents sont conserves.
 */
export function sansTextesDupliques<T extends { type: string }>(parts: readonly T[]): T[] {
  const vus = new Set<string>()
  return parts.filter((p) => {
    if (p.type !== 'text') return true
    const texte = (p as { text?: unknown }).text
    if (typeof texte !== 'string') return true
    const norme = normaliserTexte(texte)
    if (norme.length < LONGUEUR_MIN_DEDOUBLONNAGE) return true
    if (vus.has(norme)) return false
    vus.add(norme)
    return true
  })
}

/** Texte brut d'un message : concatenation de ses parties `text` (sans doublon). */
export function texteDuMessage(message: MessageUI): string {
  return sansTextesDupliques(message.parts)
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof (p as { text?: unknown }).text === 'string')
    .map((p) => p.text)
    .join('\n\n')
}
