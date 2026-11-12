/**
 * Conversion des cellules et totaux exacts des colonnes additives d'un jeu.
 */

import type { Cellule, ColonneJeu, LigneJeu, TypeColonne } from '@/lib/medic-assist/contrats'

/** Échelle de la somme entière : centimes pour un montant, micro-unités pour un décimal. */
const ECHELLE: Partial<Record<TypeColonne, number>> = {
  entier: 1,
  decimal: 1_000_000,
  montant: 100,
}

/** Vrai si les valeurs de la colonne s'additionnent (jamais un pourcentage ni une période). */
export function estAdditive(type: TypeColonne): boolean {
  return ECHELLE[type] !== undefined
}

/** Valeur brute (Date, bigint, Decimal...) -> cellule JSON. */
export function versCellule(valeur: unknown): Cellule {
  if (valeur === null || valeur === undefined) return null
  if (typeof valeur === 'string' || typeof valeur === 'boolean') return valeur
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null
  if (typeof valeur === 'bigint') return Number(valeur)
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur.toISOString()
  if (typeof (valeur as { toNumber?: unknown }).toNumber === 'function') {
    const n = (valeur as { toNumber: () => number }).toNumber()
    return Number.isFinite(n) ? n : null
  }
  try {
    return JSON.stringify(valeur) ?? null
  } catch {
    return null
  }
}

/** Ne garde que les colonnes déclarées, chaque valeur en cellule (absente : null). */
export function lignesVersCellules(
  colonnes: readonly ColonneJeu[],
  lignes: readonly Record<string, unknown>[]
): LigneJeu[] {
  return lignes.map(ligne => {
    const cellules: LigneJeu = {}
    for (const colonne of colonnes) cellules[colonne.cle] = versCellule(ligne?.[colonne.cle])
    return cellules
  })
}

/**
 * Somme EXACTE des colonnes additives : sommes d'entiers (centimes pour un montant), puis une
 * seule division, sans dérive flottante (0,1 + 0,2 = 0,3). Les valeurs non numériques sont
 * ignorées ; une colonne sans aucune valeur numérique n'a pas de total.
 */
export function calculerTotaux(
  colonnes: readonly ColonneJeu[],
  lignes: readonly LigneJeu[],
  exclues: ReadonlySet<string> = new Set()
): Record<string, number> | undefined {
  const totaux: Record<string, number> = {}
  for (const colonne of colonnes) {
    const echelle = ECHELLE[colonne.type]
    if (echelle === undefined || exclues.has(colonne.cle)) continue
    let somme = BigInt(0)
    let vu = false
    for (const ligne of lignes) {
      const v = ligne[colonne.cle]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      somme += BigInt(Math.round(v * echelle))
      vu = true
    }
    if (vu) totaux[colonne.cle] = Number(somme) / echelle
  }
  return Object.keys(totaux).length > 0 ? totaux : undefined
}
