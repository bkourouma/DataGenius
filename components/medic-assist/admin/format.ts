/**
 * Formats d'affichage de l'administration (nombres, montants, dates), dans la
 * langue active. L'euro est la devise de l'application ; le dollar garde son symbole.
 */

export interface Formats {
  entier: (valeur: number) => string;
  decimal: (valeur: number) => string;
  usd: (valeur: number) => string;
  eur: (valeur: number) => string;
  /** Jour AAAA-MM-JJ (ou mois AAAA-MM), sans decalage de fuseau. */
  jour: (iso: string) => string;
  jourCourt: (iso: string) => string;
  dateHeure: (iso: string) => string;
}

export function creerFormats(intlTag: string): Formats {
  const entier = new Intl.NumberFormat(intlTag, { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(intlTag, { maximumFractionDigits: 4 });
  const usd = new Intl.NumberFormat(intlTag, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  const eur = new Intl.NumberFormat(intlTag, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  const jour = new Intl.DateTimeFormat(intlTag, { dateStyle: 'medium', timeZone: 'UTC' });
  const jourCourt = new Intl.DateTimeFormat(intlTag, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const mois = new Intl.DateTimeFormat(intlTag, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const moisCourt = new Intl.DateTimeFormat(intlTag, {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
  const dateHeure = new Intl.DateTimeFormat(intlTag, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });

  // Une periode « AAAA-MM » (groupement par mois) vaut le premier du mois.
  const enDate = (iso: string) =>
    new Date(iso.length === 7 ? `${iso}-01T00:00:00Z` : `${iso.slice(0, 10)}T00:00:00Z`);
  const estMois = (iso: string) => iso.length === 7;

  return {
    entier: valeur => entier.format(valeur),
    decimal: valeur => decimal.format(valeur),
    usd: valeur => usd.format(valeur),
    eur: valeur => eur.format(valeur),
    jour: iso => (estMois(iso) ? mois : jour).format(enDate(iso)),
    jourCourt: iso => (estMois(iso) ? moisCourt : jourCourt).format(enDate(iso)),
    dateHeure: iso => {
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? iso : dateHeure.format(date);
    },
  };
}
