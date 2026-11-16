/**
 * Export CSV du journal d'audit.
 *
 * Toute cellule texte dont le premier caractère est interprété comme une formule par un tableur
 * (= + - @ tabulation retour chariot) est préfixée d'une apostrophe : sans cela, un libellé saisi
 * par un utilisateur pourrait s'exécuter à l'ouverture du fichier (injection de formule).
 */

const DEBUTS_DANGEREUX = new Set(['=', '+', '-', '@', '\t', '\r'])
const BOM_UTF8 = '﻿'
const FIN_DE_LIGNE = '\r\n'

function enTexte(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return ''
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? '' : valeur.toISOString()
  if (typeof valeur === 'object') {
    try {
      return JSON.stringify(valeur) ?? ''
    } catch {
      return ''
    }
  }
  return String(valeur)
}

/** Neutralise l'injection de formule puis met la cellule entre guillemets si nécessaire. */
export function echapperCelluleCsv(valeur: unknown): string {
  let texte = enTexte(valeur)
  // Un nombre JS réel (ex. -5) reste tel quel : seuls les textes sont préfixés.
  if (typeof valeur !== 'number' && texte !== '' && DEBUTS_DANGEREUX.has(texte[0])) texte = `'${texte}`
  if (/[;",\r\n]/.test(texte)) return `"${texte.replaceAll('"', '""')}"`
  return texte
}

/** Séparateur virgule, fin de ligne CRLF, BOM UTF-8 en tête (Excel). */
export function construireCsv(entetes: string[], lignes: unknown[][]): string {
  const toutes = [entetes, ...lignes]
  return BOM_UTF8 + toutes.map((ligne) => ligne.map(echapperCelluleCsv).join(',')).join(FIN_DE_LIGNE) + FIN_DE_LIGNE
}
