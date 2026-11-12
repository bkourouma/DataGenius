/**
 * Exercice budgetaire ILAPHARM : avril N -> mars N+1.
 *
 * L'exercice N couvre douze periodes consecutives, d'avril de l'annee N a mars de
 * l'annee N+1. La table `budget_ventes` reste en annee civile (`annee` + `mois`) :
 * les neuf premiers mois de l'exercice N tombent donc sur l'annee N, les trois
 * derniers sur l'annee N+1. Deux exercices consecutifs ne se recouvrent jamais.
 */

/** Premier mois de l'exercice (avril). */
export const MOIS_DEBUT_EXERCICE = 4;

/** Nombre de mois d'un exercice. */
export const NB_MOIS_EXERCICE = 12;

/** Une case mensuelle de l'exercice, avec sa position en annee civile. */
export interface MoisExercice {
  /** Rang dans l'exercice, de 0 (avril) a 11 (mars). */
  rang: number;
  /** Annee civile de ce mois. */
  annee: number;
  /** Mois civil, de 1 a 12. */
  mois: number;
  /** Periode au format `YYYY-MM`, tel que stocke dans SortiesLocales. */
  period: string;
}

/** Les douze mois de l'exercice `annee`, d'avril a mars. */
export function moisExercice(annee: number): MoisExercice[] {
  return Array.from({ length: NB_MOIS_EXERCICE }, (_, rang) => {
    const moisAbsolu = MOIS_DEBUT_EXERCICE + rang; // 4..15
    const decalageAnnee = moisAbsolu > 12 ? 1 : 0;
    const mois = moisAbsolu > 12 ? moisAbsolu - 12 : moisAbsolu;
    const anneeCivile = annee + decalageAnnee;

    return {
      rang,
      annee: anneeCivile,
      mois,
      period: `${anneeCivile}-${String(mois).padStart(2, '0')}`,
    };
  });
}

/** Les douze periodes `YYYY-MM` de l'exercice `annee`. */
export function periodesExercice(annee: number): string[] {
  return moisExercice(annee).map(m => m.period);
}

/** Periodes de plusieurs exercices, sans doublon. */
export function periodesExercices(annees: number[]): string[] {
  return Array.from(new Set(annees.flatMap(periodesExercice)));
}

/**
 * Clause Prisma qui selectionne les lignes `budget_ventes` d'un exercice.
 * Deux blocs : avril-decembre sur l'annee N, janvier-mars sur l'annee N+1.
 */
export function clauseExerciceBudget(annee: number) {
  return {
    OR: [
      { annee, mois: { in: [4, 5, 6, 7, 8, 9, 10, 11, 12] } },
      { annee: annee + 1, mois: { in: [1, 2, 3] } },
    ],
  };
}

/** Vrai si le couple (annee civile, mois) appartient a l'exercice `annee`. */
export function appartientExercice(exercice: number, annee: number, mois: number): boolean {
  if (annee === exercice) return mois >= MOIS_DEBUT_EXERCICE;
  if (annee === exercice + 1) return mois < MOIS_DEBUT_EXERCICE;
  return false;
}

/** Exercice auquel appartient un couple (annee civile, mois). */
export function exerciceDeAnneeMois(annee: number, mois: number): number {
  return mois >= MOIS_DEBUT_EXERCICE ? annee : annee - 1;
}

/** Exercice auquel appartient une periode `YYYY-MM`. */
export function exerciceDePeriode(period: string): number {
  const [annee, mois] = period.split('-').map(Number);
  return exerciceDeAnneeMois(annee, mois);
}

/**
 * Rang d'un mois civil dans son exercice, de 0 (avril) a 11 (mars).
 * Sert a ordonner un axe mensuel : un rapport d'exercice commence en avril et
 * se termine en mars, jamais en janvier.
 */
export function rangDansExercice(mois: number): number {
  return (mois - MOIS_DEBUT_EXERCICE + 12) % 12;
}

/** Bornes de dates d'un exercice : du 1er avril N au 31 mars N+1 inclus. */
export function bornesExercice(annee: number): { debut: Date; fin: Date } {
  return {
    debut: new Date(Date.UTC(annee, MOIS_DEBUT_EXERCICE - 1, 1)),
    // Dernier instant du 31 mars N+1 : la milliseconde qui precede le 1er avril.
    fin: new Date(Date.UTC(annee + 1, MOIS_DEBUT_EXERCICE - 1, 1) - 1),
  };
}

/**
 * Exercices deduits d'une liste de couples (annee, mois) issus de la base,
 * tries du plus recent au plus ancien.
 */
export function exercicesDeCouples(couples: { annee: number; mois: number }[]): number[] {
  const exercices = new Set(couples.map(c => exerciceDeAnneeMois(c.annee, c.mois)));
  return Array.from(exercices).sort((a, b) => b - a);
}

/**
 * Toutes les periodes `YYYY-MM` comprises entre deux bornes incluses.
 * Utile pour aligner un filtre de budget, indexe par (annee, mois), sur une
 * fenetre de ventes exprimee en periodes.
 */
export function periodesEntre(debut: string, fin: string): string[] {
  const [anneeDebut, moisDebut] = debut.split('-').map(Number);
  const [anneeFin, moisFin] = fin.split('-').map(Number);

  const periodes: string[] = [];
  let annee = anneeDebut;
  let mois = moisDebut;

  // Garde-fou : une borne inversee ou aberrante ne doit pas boucler sans fin.
  while ((annee < anneeFin || (annee === anneeFin && mois <= moisFin)) && periodes.length < 600) {
    periodes.push(`${annee}-${String(mois).padStart(2, '0')}`);
    mois += 1;
    if (mois > 12) {
      mois = 1;
      annee += 1;
    }
  }

  return periodes;
}

/** Exercices deduits d'une liste de periodes `YYYY-MM`, du plus recent au plus ancien. */
export function exercicesDePeriodes(periodes: string[]): number[] {
  const exercices = new Set(periodes.map(exerciceDePeriode));
  return Array.from(exercices).sort((a, b) => b - a);
}

/** Libelle d'un exercice, par exemple `2026/2027`. */
export function libelleExercice(annee: number): string {
  return `${annee}/${annee + 1}`;
}

/** Exercice en cours a une date donnee (par defaut aujourd'hui). */
export function exerciceCourant(date: Date = new Date()): number {
  const mois = date.getMonth() + 1;
  return mois >= MOIS_DEBUT_EXERCICE ? date.getFullYear() : date.getFullYear() - 1;
}

/**
 * Cumul depuis le debut de l'exercice : l'exercice en cours et la liste des mois
 * civils deja ecoules, d'avril jusqu'au mois de la date.
 *
 * Un « cumul annuel » calcule de janvier a aujourd'hui n'aurait aucun sens face
 * a un budget qui demarre en avril.
 */
export function cumulExerciceADate(date: Date = new Date()): { exercice: number; mois: number[] } {
  const exercice = exerciceCourant(date);
  const moisCourant = date.getMonth() + 1;

  const mois: number[] = [];
  for (const caseMois of moisExercice(exercice)) {
    mois.push(caseMois.mois);
    if (caseMois.annee === date.getFullYear() && caseMois.mois === moisCourant) break;
  }

  return { exercice, mois };
}

/**
 * Repartit un total annuel sur douze mois selon des poids, en conservant
 * exactement le total : la methode des plus forts restes distribue les unites
 * perdues par l'arrondi aux mois dont la decimale est la plus elevee.
 *
 * Des poids tous nuls (produit sans historique) donnent une repartition egale.
 */
export function repartirSurMois(total: number, poids: number[]): number[] {
  const cases = poids.length;
  const sommePoids = poids.reduce((somme, p) => somme + Math.max(0, p), 0);
  const base = sommePoids > 0 ? poids.map(p => Math.max(0, p) / sommePoids) : poids.map(() => 1 / cases);

  const exacts = base.map(part => total * part);
  const planchers = exacts.map(v => Math.floor(v));
  let reste = Math.round(total - planchers.reduce((somme, v) => somme + v, 0));

  // Les restes les plus eleves recoivent l'unite supplementaire, a poids egal on
  // privilegie le mois le plus tot dans l'exercice.
  const ordre = exacts
    .map((valeur, index) => ({ index, reste: valeur - Math.floor(valeur) }))
    .sort((a, b) => b.reste - a.reste || a.index - b.index);

  const resultat = [...planchers];
  for (let i = 0; reste > 0 && i < ordre.length; i++, reste--) {
    resultat[ordre[i].index] += 1;
  }

  return resultat;
}
