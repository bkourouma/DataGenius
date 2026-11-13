/**
 * Le temps vu par le moteur semantique : dimensions temporelles ajoutees par la granularite
 * et libelle court d'une periode.
 *
 * Le moteur ne suppose RIEN d'autre que le contrat `TempsJeu` (catalogue/types.ts) : une vue
 * de jeu a temps expose `periode` ('YYYY-MM'), `annee`, `mois` (1-12) et `exercice` (annee
 * de depart, avril -> mars). Les expressions ci-dessous n'utilisent que ces quatre colonnes.
 */

import { libellePeriodeCourte } from '@/lib/donnees/periodes'
import { MOIS_DEBUT_EXERCICE } from '@/lib/utils/exercice'
import { citer } from '@/lib/warehouse/configuration'

import type { Locale } from '@/i18n/config'
import { libelleDe } from '../catalogue/communs'
import type { DefinitionDimension, DefinitionJeu, RequeteNormalisee, TempsJeu } from '../catalogue/types'
import { TEXTES_MOTEUR } from './libelles'

export type Granularite = NonNullable<RequeteNormalisee['granularite']>

export const GRANULARITES: readonly Granularite[] = ['mois', 'trimestre', 'exercice', 'annee']

/**
 * Dimensions temporelles generiques d'un jeu a temps, par granularite. Leur cle est aussi
 * celle de la colonne rendue.
 *  - mois : la periode 'YYYY-MM' ;
 *  - trimestre : trimestre CIVIL 'YYYY-Tn' (T1 = janvier-mars). Hypothese : l'exercice
 *    commence en avril, un trimestre d'exercice serait decale ; on garde le civil, signale
 *    dans la provenance ;
 *  - exercice : libelle 'YYYY/YYYY+1' (comme `libelleExercice`), plutot que l'entier 2026,
 *    qu'on confondrait avec l'annee civile et qu'un format numerique ecrirait « 2 026 » ;
 *  - annee : annee civile, en texte pour la meme raison.
 */
export const DIMENSIONS_TEMPORELLES: Record<Granularite, DefinitionDimension> = {
  mois: {
    cle: 'periode',
    libelle: TEXTES_MOTEUR.colonneMois,
    definition: 'Mois de la ligne, au format YYYY-MM.',
    type: 'periode',
    expression: 'periode',
  },
  trimestre: {
    cle: 'trimestre',
    libelle: TEXTES_MOTEUR.colonneTrimestre,
    definition: 'Trimestre civil de la ligne, au format YYYY-Tn (T1 = janvier a mars).',
    type: 'texte',
    expression: "(annee)::int::text || '-T' || ((((mois)::int - 1) / 3) + 1)::text",
  },
  exercice: {
    cle: 'exercice',
    libelle: TEXTES_MOTEUR.colonneExercice,
    definition:
      "Exercice d'avril a mars, au format YYYY/YYYY+1 (2026/2027 = avril 2026 a mars 2027).",
    type: 'texte',
    expression: "(exercice)::int::text || '/' || ((exercice)::int + 1)::text",
  },
  annee: {
    cle: 'annee',
    libelle: TEXTES_MOTEUR.colonneAnnee,
    definition: 'Annee civile de la ligne (janvier a decembre).',
    type: 'texte',
    expression: '(annee)::int::text',
  },
}

/** Cles des dimensions temporelles generiques. */
export const CLES_TEMPORELLES = new Set(Object.values(DIMENSIONS_TEMPORELLES).map(d => d.cle))

export function bornesExerciceCalendaire(annee: number, mois: number): { debut: string; fin: string } {
  const format = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}`
  return { debut: format(annee, mois), fin: mois === 1 ? format(annee, 12) : format(annee + 1, mois - 1) }
}

function dimensionCalendaire(granularite: Granularite, { colonneDate, moisDebutExercice }: NonNullable<TempsJeu['calendrier']>): DefinitionDimension {
  const date = citer(colonneDate).sql
  const annee = `EXTRACT(YEAR FROM ${date})::int`
  const trimestre = `EXTRACT(QUARTER FROM ${date})::int`
  const exercice = `EXTRACT(YEAR FROM (${date} - INTERVAL '${moisDebutExercice - 1} months'))::int`
  const expressions = {
    mois: `TO_CHAR(${date}, 'YYYY-MM')`,
    trimestre: `${annee}::text || '-T' || ${trimestre}::text`,
    annee: `${annee}::text`,
    exercice: moisDebutExercice === 1 ? `${annee}::text` : `${exercice}::text || '/' || (${exercice} + 1)::text`,
  }
  const base = DIMENSIONS_TEMPORELLES[granularite]
  return {
    ...base,
    definition: granularite === 'exercice' ? `Exercice dont le mois de début est ${moisDebutExercice}.` : base.definition,
    expression: expressions[granularite],
  }
}

/**
 * Dimensions selectionnables d'un jeu : celles du catalogue, plus, pour un jeu a temps, les
 * dimensions temporelles generiques que le catalogue ne declare pas lui-meme (une
 * declaration du catalogue a toujours priorite).
 */
export function dimensionsDisponibles(jeu: DefinitionJeu): DefinitionDimension[] {
  if (!jeu.temps) return [...jeu.dimensions]
  const declarees = new Set(jeu.dimensions.map(d => d.cle))
  const generiques = GRANULARITES.map(g => dimensionDeGranularite(jeu, g)).filter(
    d => !declarees.has(d.cle)
  )
  return [...jeu.dimensions, ...generiques]
}

/** Dimension rendue pour une granularite : celle du catalogue si elle existe sous la meme cle. */
export function dimensionDeGranularite(
  jeu: DefinitionJeu,
  granularite: Granularite
): DefinitionDimension {
  const generique = jeu.temps?.calendrier ? dimensionCalendaire(granularite, jeu.temps.calendrier) : DIMENSIONS_TEMPORELLES[granularite]
  return jeu.dimensions.find(d => d.cle === generique.cle) ?? generique
}

/**
 * Dimensions rendues par une requete, dans l'ordre des colonnes : la dimension de la
 * granularite en tete (sauf si elle est deja demandee, ou elle garde sa place), puis les
 * dimensions demandees. Les cles ont ete validees (`validerRequete`).
 */
export function dimensionsSelectionnees(
  jeu: DefinitionJeu,
  cles: readonly string[],
  granularite?: Granularite
): DefinitionDimension[] {
  const disponibles = dimensionsDisponibles(jeu)
  const demandees = cles.map(cle => {
    const dimension = disponibles.find(d => d.cle === cle)
    if (!dimension) throw new Error(`Dimension non validee : ${cle}`)
    return dimension
  })
  if (!granularite) return demandees
  const temporelle = dimensionDeGranularite(jeu, granularite)
  return demandees.some(d => d.cle === temporelle.cle) ? demandees : [temporelle, ...demandees]
}

/** Vrai si la dimension decoupe le temps (tri par defaut croissant, en tete). */
export function estTemporelle(dimension: DefinitionDimension): boolean {
  return (
    dimension.type === 'periode' || CLES_TEMPORELLES.has(dimension.cle) || dimension.cle === 'mois'
  )
}

/** Vrai si la dimension est au grain du mois (`periode`) : seule a separer des instantanes. */
export function estAuGrainDuMois(dimension: DefinitionDimension): boolean {
  return dimension.expression.trim() === 'periode'
}

/**
 * Libelle court d'une periode (`libellePeriodeCourte`) :
 * « 09/26 », « 04/26 – 09/26 ». Quand plusieurs mois tiennent dans un meme exercice, on
 * ajoute « ; exercice 2026/2027 » (mot traduit, millesime identique dans toutes les langues).
 */
export function libellePeriode(debut: string, fin: string, locale: Locale, moisDebut = MOIS_DEBUT_EXERCICE): string {
  const base = libellePeriodeCourte(debut, fin)
  if (debut === fin) return base
  const exerciceDePeriode = (periode: string) => {
    const [annee, mois] = periode.split('-').map(Number)
    return mois >= moisDebut ? annee : annee - 1
  }
  const exercice = exerciceDePeriode(debut)
  if (exercice !== exerciceDePeriode(fin)) return base
  const libelle = moisDebut === 1 ? String(exercice) : `${exercice}/${exercice + 1}`
  return `${base} ; ${libelleDe(TEXTES_MOTEUR.exercice, locale)} ${libelle}`
}
