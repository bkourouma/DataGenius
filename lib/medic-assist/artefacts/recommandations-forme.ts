/**
 * Recommandations et changements de forme de graphique, sans rappeler l'IA.
 *
 * Module pur. Toute spécification rendue par `appliquerChangementForme` respecte les règles
 * du contrat (GraphiqueSpecSchema) : une seule série pour les formes à une mesure, au moins
 * deux pour `combine`, `serie` obligatoire pour `carte_chaleur`.
 */

import { estFormatNumerique } from './formats'
import { FORMES_GRAPHIQUE, FORMES_UNE_MESURE } from '@/lib/medic-assist/contrats'

import type { FormeGraphique, GraphiqueSpec, SerieGraphique } from '@/lib/medic-assist/contrats'
import type { JeuClient } from './types-rendu'

/** Au-delà, un secteur, un anneau, un entonnoir ou une jauge devient illisible. */
export const MAX_CATEGORIES_SECTEURS = 8

export type MotifForme =
  | 'trop_de_categories'
  | 'une_mesure_requise'
  | 'deux_mesures_requises'
  | 'serie_requise'
  | 'categories_insuffisantes'

export interface EvaluationForme {
  ok: boolean
  motif?: MotifForme
  formeRecommandee: FormeGraphique
}

export interface FormeProposee {
  forme: FormeGraphique
  disponible: boolean
  motif?: MotifForme
}

export interface ChangementForme {
  spec: GraphiqueSpec
  formeEffective: FormeGraphique
  motif?: MotifForme
}

/** Formes limitées à MAX_CATEGORIES_SECTEURS catégories (le treemap n'a pas cette limite). */
const FORMES_PARTS: readonly FormeGraphique[] = ['secteurs', 'anneau', 'entonnoir', 'jauge']
/** Formes qui exigent au moins deux catégories pour avoir un sens. */
const FORMES_DEUX_CATEGORIES: readonly FormeGraphique[] = ['secteurs', 'anneau', 'entonnoir']

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------

function cloner(spec: GraphiqueSpec): GraphiqueSpec {
  return { ...spec, y: spec.y.map(s => ({ ...s })) }
}

function estMesure(jeu: JeuClient, cle: string): boolean {
  const col = jeu.colonnes.find(c => c.cle === cle)
  return !!col && estFormatNumerique(col.type)
}

function mesuresDuJeu(jeu: JeuClient): string[] {
  return jeu.colonnes.filter(c => estFormatNumerique(c.type)).map(c => c.cle)
}

/** Nombre de valeurs distinctes (non vides) de la dimension `spec.x`. */
export function compterCategories(spec: GraphiqueSpec, jeu: JeuClient): number {
  const vues = new Set<string>()
  for (const ligne of jeu.lignes ?? []) {
    const v = ligne[spec.x]
    if (v === null || v === undefined || v === '') continue
    vues.add(String(v))
  }
  return vues.size
}

/** Première dimension du jeu, la chronologique d'abord si `chrono`. */
function premiereDimension(jeu: JeuClient, chrono: boolean): string | null {
  const dims = jeu.colonnes.filter(c => !estFormatNumerique(c.type))
  if (chrono) {
    const temps = dims.find(c => c.type === 'periode' || c.type === 'date')
    if (temps) return temps.cle
  }
  return dims.find(c => c.type === 'texte')?.cle ?? dims[0]?.cle ?? null
}

/**
 * Quitte le nuage : son `x` est une mesure, il faut une dimension à la place (la mesure
 * d'abscisse devient la première série). Null si le jeu n'a aucune dimension.
 */
function depuisNuage(spec: GraphiqueSpec, jeu: JeuClient, cible: FormeGraphique): GraphiqueSpec | null {
  if (!estMesure(jeu, spec.x)) return cloner(spec)
  const dimension = premiereDimension(jeu, cible === 'lignes' || cible === 'aires')
  if (!dimension) return null
  const copie = cloner(spec)
  copie.x = dimension
  if (!copie.y.some(s => s.cle === spec.x)) copie.y = [{ cle: spec.x }, ...copie.y]
  return copie
}

/** Forme de base quand la forme demandée est inadaptée : chronologique ou barres. */
function formeDeBase(spec: GraphiqueSpec, jeu: JeuClient): FormeGraphique {
  const col = jeu.colonnes.find(c => c.cle === spec.x)
  return col && (col.type === 'periode' || col.type === 'date') ? 'lignes' : 'barres'
}

// ---------------------------------------------------------------------------
// Disponibilité
// ---------------------------------------------------------------------------

function verifier(
  spec: GraphiqueSpec,
  forme: FormeGraphique,
  jeu: JeuClient,
  strict: boolean
): MotifForme | undefined {
  if (forme === 'nuage') {
    return mesuresDuJeu(jeu).length < 2 ? 'deux_mesures_requises' : undefined
  }
  // Un nuage devient une autre forme : on évalue avec une dimension en abscisse.
  let base: GraphiqueSpec | null = spec
  if (spec.forme === 'nuage') {
    base = depuisNuage(spec, jeu, forme)
    if (!base) return 'categories_insuffisantes'
  }

  if (forme === 'combine') return base.y.length < 2 ? 'deux_mesures_requises' : undefined
  if (forme === 'carte_chaleur') {
    if (!base.serie) return 'serie_requise'
    return strict && base.y.length !== 1 ? 'une_mesure_requise' : undefined
  }
  if (FORMES_UNE_MESURE.includes(forme) && strict && base.y.length !== 1) {
    return 'une_mesure_requise'
  }
  if (FORMES_PARTS.includes(forme)) {
    const n = compterCategories(base, jeu)
    if (n > MAX_CATEGORIES_SECTEURS) return 'trop_de_categories'
    if (FORMES_DEUX_CATEGORIES.includes(forme) && n < 2) return 'categories_insuffisantes'
  }
  return undefined
}

/** Valide la forme courante de la spécification pour ce jeu et recommande une alternative. */
export function evaluerForme(spec: GraphiqueSpec, jeu: JeuClient): EvaluationForme {
  const motif = verifier(spec, spec.forme, jeu, true)
  if (!motif) return { ok: true, formeRecommandee: spec.forme }
  const formeRecommandee: FormeGraphique =
    motif === 'trop_de_categories' ? 'barres_horizontales' : formeDeBase(spec, jeu)
  return { ok: false, motif, formeRecommandee }
}

/** Les 13 formes avec leur disponibilité pour ce jeu (l'interface grise les indisponibles). */
export function formesProposees(spec: GraphiqueSpec, jeu: JeuClient): FormeProposee[] {
  return FORMES_GRAPHIQUE.map(forme => {
    const motif = verifier(spec, forme, jeu, false)
    return motif ? { forme, disponible: false, motif } : { forme, disponible: true }
  })
}

// ---------------------------------------------------------------------------
// Changement de forme
// ---------------------------------------------------------------------------

/** Série sans sa forme propre (réservée à `combine`). */
function sansForme(serie: SerieGraphique): SerieGraphique {
  const copie = { ...serie }
  delete copie.forme
  return copie
}

/** Assure au moins une série en barres et une en lignes pour la forme combinée. */
function formesCombine(y: SerieGraphique[]): SerieGraphique[] {
  if (y.some(s => s.forme)) return y.map(s => ({ ...s, forme: s.forme ?? 'lignes' }))
  return y.map((s, i) => ({ ...s, forme: i === 0 ? 'barres' : 'lignes' }))
}

export function appliquerChangementForme(
  spec: GraphiqueSpec,
  nouvelleForme: FormeGraphique,
  jeu: JeuClient
): ChangementForme {
  const refus = (motif: MotifForme): ChangementForme => ({
    spec: cloner(spec),
    formeEffective: spec.forme,
    motif,
  })

  if (nouvelleForme === spec.forme) return { spec: cloner(spec), formeEffective: spec.forme }

  let cible = nouvelleForme
  let motifRemplacement: MotifForme | undefined

  const motif = verifier(spec, cible, jeu, false)
  if (motif === 'trop_de_categories') {
    // Trop de parts : barres horizontales plutôt qu'un camembert illisible.
    cible = 'barres_horizontales'
    motifRemplacement = motif
  } else if (motif) {
    return refus(motif)
  }

  let base: GraphiqueSpec | null = cloner(spec)
  if (spec.forme === 'nuage' && cible !== 'nuage') {
    base = depuisNuage(spec, jeu, cible)
    if (!base) return refus('categories_insuffisantes')
  }
  const resultat = base
  resultat.forme = cible

  if (cible === 'nuage') {
    // x et y deviennent deux mesures distinctes ; l'ancienne dimension est abandonnée.
    const mesures = mesuresDuJeu(jeu)
    const candidates = [
      ...(estMesure(jeu, spec.x) ? [spec.x] : []),
      ...spec.y.map(s => s.cle).filter(c => estMesure(jeu, c)),
      ...mesures,
    ]
    const uniques = candidates.filter((c, i) => candidates.indexOf(c) === i)
    const x = uniques[0]
    let y = spec.y.filter(s => s.cle !== x && estMesure(jeu, s.cle))
    if (y.length === 0) y = [{ cle: uniques[1] }]
    resultat.x = x
    resultat.y = y.map(sansForme)
    delete resultat.empile
    return finaliser(resultat, cible, motifRemplacement)
  }

  if (FORMES_UNE_MESURE.includes(cible)) {
    resultat.y = [resultat.y[0]]
  }

  if (spec.forme === 'combine') {
    resultat.y = resultat.y.map(sansForme)
  }

  if (cible === 'combine') {
    resultat.y = formesCombine(resultat.y)
  } else if (cible === 'barres_empilees') {
    resultat.empile = true
  } else if (cible === 'aires') {
    if (spec.forme === 'barres_empilees') resultat.empile = true
  } else if (FORMES_UNE_MESURE.includes(cible)) {
    delete resultat.empile
  } else if (spec.forme === 'barres_empilees') {
    delete resultat.empile
  }

  return finaliser(resultat, cible, motifRemplacement)
}

function finaliser(
  spec: GraphiqueSpec,
  forme: FormeGraphique,
  motif: MotifForme | undefined
): ChangementForme {
  return motif ? { spec, formeEffective: forme, motif } : { spec, formeEffective: forme }
}
