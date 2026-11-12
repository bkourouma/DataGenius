/**
 * Date butoir de saisie des sorties locales, sans dependance serveur : l'ecran
 * s'en sert aussi pour caler ses periodes par defaut sur le dernier mois clos.
 *
 * Le jour limite lui-meme est un parametre en base (`lireJourLimite`, cote
 * serveur) ; ce module ne connait que sa valeur par defaut.
 */

/** Jour retenu tant qu'aucun parametrage n'a ete enregistre. */
export const JOUR_LIMITE_DEFAUT = 10;

/**
 * Date butoir d'une periode : le jour limite du mois qui suit le mois declare.
 * Decembre 2025 avec un jour limite au 10 donne le 10 janvier 2026.
 */
export function dateLimitePourPeriode(period: string, jourLimite: number): Date {
  const [year, month] = period.split('-').map(Number);
  // `month` est 1-12 ; `month` en base 0 designe deja le mois suivant.
  return new Date(year, month, jourLimite, 23, 59, 59, 999);
}
