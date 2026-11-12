/**
 * Revue du mois : quels mois sont comparables a une date donnee.
 *
 * Une agence declare le mois ecoule pendant le mois suivant, jusqu'au jour limite
 * de saisie. Tant que ce jour n'est pas passe, le mois est incomplet : le comparer
 * au budget ferait croire a une chute. La revue ne lit donc que des mois clos.
 *
 * Sans dependance serveur : les ecrans de rapport s'en servent pour leur periode
 * par defaut (voir lib/reports/plage-ventes-defaut).
 */

import { dateLimitePourPeriode } from '@/lib/utils/delai-saisie';
import { decalerPeriode, periodeDe } from './periodes';
import type { EtatMois } from './types';

export { decalerPeriode, periodeDe };

export function etatDuMois(periode: string, maintenant: Date, jourLimite: number): EtatMois {
  if (maintenant.getTime() > dateLimitePourPeriode(periode, jourLimite).getTime()) return 'clos';
  const courante = periodeDe(maintenant);
  if (periode < courante) return 'enSaisie';
  if (periode === courante) return 'enCours';
  return 'aVenir';
}

/** Le plus recent mois dont le jour limite de saisie est passe. */
export function dernierMoisClos(maintenant: Date, jourLimite: number): string {
  let periode = periodeDe(maintenant);
  while (etatDuMois(periode, maintenant, jourLimite) !== 'clos') {
    periode = decalerPeriode(periode, -1);
  }
  return periode;
}
