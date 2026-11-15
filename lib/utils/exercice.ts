/**
 * Exercice : douze periodes consecutives, calees sur le mois de debut de l'exercice.
 *
 * Par defaut l'exercice suit l'annee civile (janvier N -> decembre N). Un
 * administrateur peut regler un autre mois de debut par jeu dans le catalogue metier ;
 * ces fonctions utilitaires s'appliquent au mois par defaut. Pour un exercice decale
 * (par exemple avril), l'exercice N va d'avril N a mars N+1 et deux exercices
 * consecutifs ne se recouvrent jamais.
 */

/** Premier mois de l'exercice par defaut (janvier : annee civile). */
export const MOIS_DEBUT_EXERCICE = 1;

/** Nombre de mois d'un exercice. */
export const NB_MOIS_EXERCICE = 12;

/** Une case mensuelle de l'exercice, avec sa position en annee civile. */
export interface MoisExercice {
  /** Rang dans l'exercice, de 0 (premier mois) a 11 (dernier mois). */
  rang: number;
  /** Annee civile de ce mois. */
  annee: number;
  /** Mois civil, de 1 a 12. */
  mois: number;
  /** Periode au format `YYYY-MM`, tel que stocke dans SortiesLocales. */
  period: string;
}

/** Les douze mois de l'exercice `annee`, du mois de debut au mois precedent. */
export function moisExercice(annee: number): MoisExercice[] {
  return Array.from({ length: NB_MOIS_EXERCICE }, (_, rang) => {
    const moisAbsolu = MOIS_DEBUT_EXERCICE + rang;
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
 * Exercice civil : une seule annee. Exercice decale : un bloc sur l'annee N
 * (du mois de debut a decembre) et un bloc sur l'annee N+1 (janvier a la veille).
 */
export function clauseExerciceBudget(annee: number) {
  if (MOIS_DEBUT_EXERCICE === 1) return { annee }

  const moisAnneeN = Array.from({ length: 13 - MOIS_DEBUT_EXERCICE }, (_, i) => MOIS_DEBUT_EXERCICE + i);
  const moisAnneeSuivante = Array.from({ length: MOIS_DEBUT_EXERCICE - 1 }, (_, i) => i + 1);

  return {
    OR: [
      { annee, mois: { in: moisAnneeN } },
      { annee: annee + 1, mois: { in: moisAnneeSuivante } },
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
 * Rang d'un mois civil dans son exercice, de 0 (premier mois) a 11 (dernier).
 * Sert a ordonner un axe mensuel : un rapport d'exercice commence au mois de debut.
 */
export function rangDansExercice(mois: number): number {
  return (mois - MOIS_DEBUT_EXERCICE + 12) % 12;
}

/** Bornes de dates d'un exercice : du 1er jour du mois de debut au dernier instant de l'exercice. */
export function bornesExercice(annee: number): { debut: Date; fin: Date } {
  return {
    debut: new Date(Date.UTC(annee, MOIS_DEBUT_EXERCICE - 1, 1)),
    // Dernier instant de l'exercice : la milliseconde qui precede le debut du suivant.
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

/**
 * Libelle d'un exercice : `2026` pour un exercice civil (janvier a decembre 2026),
 * `2026/2027` pour un exercice decale.
 */
export function libelleExercice(annee: number, moisDebut: number = MOIS_DEBUT_EXERCICE): string {
  return moisDebut === 1 ? String(annee) : `${annee}/${annee + 1}`;
}

/** Exercice en cours a une date donnee (par defaut aujourd'hui). */
export function exerciceCourant(date: Date = new Date()): number {
  const mois = date.getMonth() + 1;
  return mois >= MOIS_DEBUT_EXERCICE ? date.getFullYear() : date.getFullYear() - 1;
}

/**
 * Cumul depuis le debut de l'exercice : l'exercice en cours et la liste des mois
 * civils deja ecoules, du mois de debut jusqu'au mois de la date.
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
