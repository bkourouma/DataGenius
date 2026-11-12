/**
 * Arithmetique des periodes `YYYY-MM`, sans dependance serveur : l'ecran s'en
 * sert aussi.
 */

/** Periode decalee de `mois` mois (negatif pour reculer). */
export function decalerPeriode(periode: string, mois: number): string {
  const [annee, m] = periode.split('-').map(Number);
  const absolu = annee * 12 + (m - 1) + mois;
  return `${Math.floor(absolu / 12)}-${String((absolu % 12) + 1).padStart(2, '0')}`;
}

export function periodeDe(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
