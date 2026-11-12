/**
 * Conversion des cellules et totaux exacts des colonnes additives d'un jeu.
 */

import type { Cellule, ColonneJeu, LigneJeu, TypeColonne } from '@/lib/medic-assist/contrats'
import { estNombreAnalytique, nombreAnalytique, sommerDecimaux, type NombreAnalytique } from '@/lib/medic-assist/contrats/numerique'

const TYPES_ADDITIFS = new Set<TypeColonne>(['entier', 'decimal', 'montant'])

/** Vrai si les valeurs de la colonne s'additionnent (jamais un pourcentage ni une période). */
export function estAdditive(type: TypeColonne): boolean {
  return TYPES_ADDITIFS.has(type)
}

/** Valeur brute (Date, bigint, Decimal...) -> cellule JSON. */
export function versCellule(valeur: unknown): Cellule {
  if (valeur === null || valeur === undefined) return null
  if (typeof valeur === 'string' || typeof valeur === 'boolean') return valeur
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null
  if (typeof valeur === 'bigint') return nombreAnalytique(valeur.toString())
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
 * Somme des valeurs décimales représentées dans le jeu, sans dérive flottante.
 * Une colonne sans valeur numérique n'a pas de total.
 */
export function calculerTotaux(
  colonnes: readonly ColonneJeu[],
  lignes: readonly LigneJeu[],
  exclues: ReadonlySet<string> = new Set()
): Record<string, NombreAnalytique> | undefined {
  const totaux: Record<string, NombreAnalytique> = {}
  for (const colonne of colonnes) {
    if (!estAdditive(colonne.type) || exclues.has(colonne.cle)) continue
    const valeurs = lignes.map(ligne => ligne[colonne.cle]).filter(estNombreAnalytique)
    if (valeurs.length) totaux[colonne.cle] = sommerDecimaux(valeurs)
  }
  return Object.keys(totaux).length > 0 ? totaux : undefined
}
