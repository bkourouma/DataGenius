/**
 * Inference des colonnes (`ColonneJeu`) d'un resultat SQL controle.
 *
 * La cle est le nom de colonne rendu par Postgres. Le type se deduit du NOM d'abord (convention
 * des vues : suffixe `_eur` = montant, `_pct` ou `taux` = pourcentage), puis des VALEURS (texte
 * 'YYYY-MM' = periode, date ISO = date, entiers, decimaux). Sans aucune valeur non nulle, on
 * reprend le type declare par une vue utilisee qui porte une colonne de meme nom.
 */

import type { ColonneJeu, TypeColonne } from '@/lib/medic-assist/contrats'

const RE_PERIODE = /^\d{4}-(0[1-9]|1[0-2])$/
const RE_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** Type deduit du seul nom, ou null. */
export function typeParNom(nom: string): TypeColonne | null {
  const n = nom.toLowerCase()
  if (n.endsWith('_eur') || n === 'eur') return 'montant'
  if (n.endsWith('_pct') || n === 'pct' || /(^|_)taux(_|$)/.test(n)) return 'pourcentage'
  return null
}

/** Type deduit des valeurs non nulles, ou null s'il n'y en a aucune. */
export function typeParValeurs(valeurs: unknown[]): TypeColonne | null {
  const presentes = valeurs.filter(v => v !== null && v !== undefined)
  if (presentes.length === 0) return null
  if (presentes.every(v => typeof v === 'number')) {
    return presentes.every(v => Number.isInteger(v)) ? 'entier' : 'decimal'
  }
  if (presentes.every(v => typeof v === 'string')) {
    const textes = presentes as string[]
    if (textes.every(t => RE_PERIODE.test(t))) return 'periode'
    if (textes.every(t => RE_DATE.test(t))) return 'date'
  }
  return 'texte'
}

/** Libelle lisible tire du nom : `ca_total_eur` -> « Ca total (EUR) », `taux_pct` -> « Taux (%) ». */
export function humaniserNom(nom: string): string {
  let base = nom
  let suffixe = ''
  if (/_eur$/i.test(base)) {
    base = base.slice(0, -4)
    suffixe = ' (EUR)'
  } else if (/_pct$/i.test(base)) {
    base = base.slice(0, -4)
    suffixe = ' (%)'
  }
  const mots = base.replace(/_+/g, ' ').trim()
  const texte = mots.length ? mots.charAt(0).toUpperCase() + mots.slice(1) : nom
  return texte + suffixe
}

/**
 * Colonnes du resultat. `noms` = noms dans l'ordre de Postgres (cles de la premiere ligne, ou
 * noms deduits de la requete quand il n'y a aucune ligne). `typesDeclares` = types des colonnes
 * de meme nom dans les vues utilisees.
 */
export function infererColonnes(
  noms: string[],
  lignes: Record<string, unknown>[],
  typesDeclares: ReadonlyMap<string, TypeColonne>
): ColonneJeu[] {
  return noms.map(cle => {
    const type =
      typeParNom(cle) ??
      typeParValeurs(lignes.map(l => l[cle])) ??
      typesDeclares.get(cle) ??
      (cle === 'periode' ? 'periode' : 'texte')
    const colonne: ColonneJeu = { cle, libelle: humaniserNom(cle), type }
    if (type === 'montant') colonne.unite = 'EUR'
    if (type === 'pourcentage') colonne.unite = '%'
    return colonne
  })
}
