/** Parties pures des commentaires (utilisables côté client : aucun accès base). */

export const LONGUEUR_MAX_COMMENTAIRE = 2000

export type CodeErreurCommentaire = 'introuvable' | 'invalide' | 'interdit' | 'limite_debit'

export class ErreurCommentaire extends Error {
  readonly code: CodeErreurCommentaire

  constructor(code: CodeErreurCommentaire) {
    super(code)
    this.name = 'ErreurCommentaire'
    this.code = code
  }
}

const CONTROLES = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g
const SUBSTITUTS_ISOLES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** Longueur en points de code, comme char_length de PostgreSQL. */
export function longueurTexte(texte: string): number {
  return Array.from(texte).length
}

/**
 * Texte brut normalisé : fins de ligne en \n, caractères de contrôle (sauf \n et \t) et
 * substituts isolés retirés, puis trim. Le HTML est conservé tel quel (jamais interprété).
 * Lève ErreurCommentaire('invalide') si la longueur n'est pas comprise entre 1 et 2000.
 */
export function normaliserTexte(texte: unknown): string {
  if (typeof texte !== 'string') throw new ErreurCommentaire('invalide')
  const propre = texte
    .replace(/\r\n?/g, '\n')
    .replace(SUBSTITUTS_ISOLES, '')
    .replace(CONTROLES, '')
    .trim()
  const longueur = longueurTexte(propre)
  if (longueur < 1 || longueur > LONGUEUR_MAX_COMMENTAIRE) throw new ErreurCommentaire('invalide')
  return propre
}
