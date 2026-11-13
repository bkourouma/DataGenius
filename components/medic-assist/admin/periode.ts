/**
 * Calculs de periode de l'onglet Usages et couts (fonctions pures, dates AAAA-MM-JJ).
 * Le serveur raisonne en fuseau Europe/Paris : « aujourd'hui » l'est aussi.
 */

import type { AgregatUsage } from './dependances';

const JOUR_MS = 24 * 60 * 60 * 1000;
/** Garde-fou : une periode n'est jamais deroulee au-dela de ce nombre de jours. */
const JOURS_MAX_GRAPHIQUE = 731;

export interface Periode {
  debut: string;
  fin: string;
}

/** Date du jour a Paris, au format AAAA-MM-JJ. */
export function aujourdhuiParis(maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(maintenant);
}

function enMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function enIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function ajouterJours(iso: string, jours: number): string {
  return enIso(enMs(iso) + jours * JOUR_MS);
}

/** Les `n` derniers jours, aujourd'hui compris. */
export function derniersJours(n: number, aujourdhui: string): Periode {
  return { debut: ajouterJours(aujourdhui, -(n - 1)), fin: aujourdhui };
}

/** Du premier du mois a aujourd'hui. */
export function moisCourant(aujourdhui: string): Periode {
  return { debut: `${aujourdhui.slice(0, 8)}01`, fin: aujourdhui };
}

export function periodeValide({ debut, fin }: Periode): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(debut) && /^\d{4}-\d{2}-\d{2}$/.test(fin) && debut <= fin;
}

/** Nombre de jours de la periode, bornes comprises. */
export function nombreDeJours({ debut, fin }: Periode): number {
  return Math.floor((enMs(fin) - enMs(debut)) / JOUR_MS) + 1;
}

/** Vrai si la periode depasse la fenetre maximale acceptee par le serveur. */
export function periodeTropLongue(periode: Periode, joursMax: number): boolean {
  return periodeValide(periode) && nombreDeJours(periode) > joursMax;
}

export function memePeriode(a: Periode, b: Periode): boolean {
  return a.debut === b.debut && a.fin === b.fin;
}

export type Groupement = 'jour' | 'mois';

/** Une ligne de la serie temporelle : l'agregat du lot 0 et sa periode (AAAA-MM-JJ ou AAAA-MM). */
export type PointPeriode = AgregatUsage & { periode: string };

const POINT_VIDE: AgregatUsage = {
  requetes: 0,
  tokensEntree: 0,
  tokensSortie: 0,
  tokensCacheLecture: 0,
  tokensCacheEcriture: 0,
  coutUsd: 0,
};

function ajouterMois(mois: string, n: number): string {
  const [annee, m] = mois.split('-').map(Number);
  const index = annee * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * Ajoute les periodes sans usage (a zero) entre le debut et la fin, pour que le
 * graphique garde une echelle de temps reguliere. Les periodes hors intervalle
 * renvoyees par le serveur sont conservees. Le tri est chronologique.
 */
export function completerPeriodes(
  points: readonly PointPeriode[],
  { debut, fin }: Periode,
  groupement: Groupement
): PointPeriode[] {
  const connus = new Map(points.map(ligne => [ligne.periode, ligne]));
  const resultat: PointPeriode[] = [];

  const cles: string[] = [];
  if (groupement === 'jour') {
    const nbJours = Math.floor((enMs(fin) - enMs(debut)) / JOUR_MS) + 1;
    if (Number.isFinite(nbJours) && nbJours >= 1 && nbJours <= JOURS_MAX_GRAPHIQUE) {
      for (let i = 0; i < nbJours; i++) cles.push(ajouterJours(debut, i));
    }
  } else {
    const premier = debut.slice(0, 7);
    const dernier = fin.slice(0, 7);
    for (let m = premier; m <= dernier && cles.length <= 120; m = ajouterMois(m, 1)) cles.push(m);
  }

  for (const cle of cles) {
    resultat.push(connus.get(cle) ?? { ...POINT_VIDE, periode: cle });
    connus.delete(cle);
  }
  // Periodes inattendues (hors intervalle) : gardees, triees.
  for (const reste of connus.values()) resultat.push(reste);
  return resultat.sort((a, b) => a.periode.localeCompare(b.periode));
}
