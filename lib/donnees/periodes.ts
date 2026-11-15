/**
 * Périodes mensuelles génériques, sans dépendance serveur : l'écran peut s'en servir.
 *
 * Une période est une chaîne `AAAA-MM`. La règle de « dernier mois complet » ne dépend que de
 * la date : c'est le mois qui précède le mois courant, quel que soit le jeu de données.
 */

/** Période décalée de `mois` mois (négatif pour reculer). */
export function decalerPeriode(periode: string, mois: number): string {
  const [annee, m] = periode.split('-').map(Number)
  const absolu = annee * 12 + (m - 1) + mois
  return `${Math.floor(absolu / 12)}-${String((absolu % 12) + 1).padStart(2, '0')}`
}

/** Période `AAAA-MM` d'une date, en heure locale. */
export function periodeDe(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Dernier mois complet : le mois qui précède le mois courant. */
export function dernierMoisComplet(maintenant: Date = new Date()): string {
  return decalerPeriode(periodeDe(maintenant), -1)
}

/**
 * Libellé court d'une fenêtre de mois, le même dans toutes les langues : « 09/26 » ou
 * « 04/26 – 09/26 ». Les arguments sont lus tels quels dans `AAAA-MM` ou `AAAA-MM-JJ` :
 * pas de `Date`, donc pas de décalage de fuseau.
 */
export function libellePeriodeCourte(debut: string, fin: string): string {
  const mois = (valeur: string) => `${valeur.slice(5, 7)}/${valeur.slice(2, 4)}`
  const libelleDebut = mois(debut)
  const libelleFin = mois(fin)
  return libelleDebut === libelleFin ? libelleDebut : `${libelleDebut} – ${libelleFin}`
}
