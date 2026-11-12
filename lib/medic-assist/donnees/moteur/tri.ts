/**
 * Tri final des lignes rendues par le moteur semantique.
 */

import { trierCellules } from '@/lib/tri/libelles'

import type { Locale } from '@/i18n/config'
import type { SensTri } from '../catalogue/validation'

function estVide(valeur: unknown): boolean {
  return (
    valeur === null || valeur === undefined || (typeof valeur === 'string' && valeur.trim() === '')
  )
}

/**
 * Tri final des lignes rendues, selon la regle « Tri par libelle » du depot
 * (`lib/tri/libelles.ts` : accents et casse ignores, nombres compares comme des nombres) ;
 * les valeurs vides passent toujours en dernier, quel que soit le sens. Le SQL a deja trie
 * (et donc choisi les lignes gardees sous la limite) dans le meme ordre, a la collation de
 * la base pres ; ce tri stable n'en corrige que les nuances.
 */
export function trierLignes(
  lignes: Record<string, unknown>[],
  tri: readonly { cle: string; sens: SensTri }[],
  locale: Locale
): Record<string, unknown>[] {
  if (tri.length === 0 || lignes.length < 2) return lignes
  return lignes
    .map((ligne, rang) => ({ ligne, rang }))
    .sort((x, y) => {
      for (const { cle, sens } of tri) {
        const a = x.ligne[cle]
        const b = y.ligne[cle]
        const aVide = estVide(a)
        const bVide = estVide(b)
        if (aVide || bVide) {
          if (aVide && bVide) continue
          return aVide ? 1 : -1
        }
        const resultat = trierCellules(a, b, locale)
        if (resultat !== 0) return sens === 'desc' ? -resultat : resultat
      }
      return x.rang - y.rang
    })
    .map(({ ligne }) => ligne)
}
