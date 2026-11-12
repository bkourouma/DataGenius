/**
 * Modèle de tableau : colonnes, filtres, tri, totaux et pivot d'une spécification de tableau
 * appliquée à un jeu de données. Module pur (aucune dépendance à React ni à la base).
 *
 * Les valeurs du modèle sont BRUTES (non formatées) : le composant et les exports formatent.
 */

import { enNombre, estFormatNumerique, formatParDefaut } from './formats'
import { estDecimalExact, estNombreAnalytique, sommerDecimaux, type NombreAnalytique } from '@/lib/medic-assist/contrats/numerique'
import { comparerLibelles } from '@/lib/tri/libelles'
import { calculerPivot, creerComparateur } from './pivot'

import type {
  Agregat,
  ColonneJeu,
  ContenuTableau,
  FiltreArtefact,
  FormatColonne,
  Scalaire,
} from '@/lib/medic-assist/contrats'
import type { ColonneModele, JeuClient, ModeleTableau } from './types-rendu'

export interface OptionsModeleTableau {
  locale: string
  /** Libellé d'un agrégat pour les en-têtes du pivot (traduit par l'appelant). */
  libelleAgregat?: (agregat: Agregat) => string
}

const FORMATS_ADDITIFS: readonly FormatColonne[] = [
  'entier',
  'decimal',
  'montant',
  'montant_compact',
]

/** Vrai pour un format dont la somme a un sens (jamais pourcentage, texte ni date). */
export function estFormatAdditif(format: FormatColonne | undefined): boolean {
  return format !== undefined && FORMATS_ADDITIFS.includes(format)
}

// ---------------------------------------------------------------------------
// Colonnes
// ---------------------------------------------------------------------------

function colonneModele(col: ColonneJeu, libelle?: string, format?: FormatColonne): ColonneModele {
  const fmt = format ?? formatParDefaut(col)
  const numerique = estFormatNumerique(fmt)
  return {
    id: col.cle,
    libelle: libelle ?? col.libelle,
    format: fmt,
    type: numerique ? 'valeur' : 'dimension',
    alignement: numerique ? 'end' : 'start',
    unite: col.unite,
  }
}

function construireColonnes(jeu: JeuClient, spec: ContenuTableau): ColonneModele[] {
  const parCle = new Map(jeu.colonnes.map(c => [c.cle, c]))
  if (!spec.colonnes || spec.colonnes.length === 0) {
    return jeu.colonnes.map(c => colonneModele(c))
  }
  const colonnes: ColonneModele[] = []
  const vues = new Set<string>()
  for (const demande of spec.colonnes) {
    if (demande.visible === false) continue
    const col = parCle.get(demande.cle)
    if (!col || vues.has(col.cle)) continue
    vues.add(col.cle)
    colonnes.push(colonneModele(col, demande.libelle, demande.format))
  }
  return colonnes
}

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------

function normaliserTexte(valeur: unknown): string {
  return String(valeur)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function absent(valeur: unknown): boolean {
  return valeur === null || valeur === undefined
}

type Predicat = (cellule: unknown) => boolean

/** Prédicat d'un filtre sur une colonne ; null si le filtre est mal formé (alors ignoré). */
function creerPredicat(filtre: FiltreArtefact, colonne: ColonneJeu): Predicat | null {
  const numerique = estFormatNumerique(colonne.type)
  const { operateur, valeur } = filtre

  /** Valeur de la cellule dans l'espace de comparaison, null si absente. */
  const lire = (cellule: unknown): number | string | null => {
    if (numerique) return enNombre(cellule)
    return absent(cellule) ? null : String(cellule)
  }
  const cible = (v: Scalaire | undefined): number | string | null => {
    if (v === undefined || v === null) return null
    if (numerique) return enNombre(v)
    return String(v)
  }

  const liste = Array.isArray(valeur) ? valeur : [valeur]

  switch (operateur) {
    case 'egal': {
      const c = cible(liste[0])
      return cel => {
        const v = lire(cel)
        return v !== null && c !== null && v === c
      }
    }
    case 'different': {
      const c = cible(liste[0])
      return cel => {
        const v = lire(cel)
        return v === null || c === null || v !== c
      }
    }
    case 'contient': {
      const recherche = normaliserTexte(liste[0] ?? '')
      return cel => !absent(cel) && normaliserTexte(cel).includes(recherche)
    }
    case 'superieur':
    case 'superieur_ou_egal':
    case 'inferieur':
    case 'inferieur_ou_egal': {
      const c = cible(liste[0])
      return cel => {
        const v = lire(cel)
        if (v === null || c === null) return false
        switch (operateur) {
          case 'superieur':
            return v > c
          case 'superieur_ou_egal':
            return v >= c
          case 'inferieur':
            return v < c
          default:
            return v <= c
        }
      }
    }
    case 'parmi': {
      const cibles = liste.map(cible).filter((c): c is number | string => c !== null)
      const ensemble = new Set<number | string>(cibles)
      return cel => {
        const v = lire(cel)
        return v !== null && ensemble.has(v)
      }
    }
    case 'entre': {
      if (!Array.isArray(valeur) || valeur.length < 2) return null
      const min = cible(valeur[0])
      const max = cible(valeur[1])
      return cel => {
        const v = lire(cel)
        if (v === null || min === null || max === null) return false
        return v >= min && v <= max
      }
    }
    default:
      return null
  }
}

function appliquerFiltres(
  lignes: Record<string, unknown>[],
  jeu: JeuClient,
  filtres: FiltreArtefact[] | undefined
): { lignes: Record<string, unknown>[]; actifs: number } {
  if (!filtres || filtres.length === 0) return { lignes, actifs: 0 }
  const parCle = new Map(jeu.colonnes.map(c => [c.cle, c]))
  const actifs: { cle: string; predicat: Predicat }[] = []
  for (const filtre of filtres) {
    const colonne = parCle.get(filtre.cle)
    if (!colonne) continue
    const predicat = creerPredicat(filtre, colonne)
    if (predicat) actifs.push({ cle: filtre.cle, predicat })
  }
  if (actifs.length === 0) return { lignes, actifs: 0 }
  return {
    lignes: lignes.filter(l => actifs.every(a => a.predicat(l[a.cle]))),
    actifs: actifs.length,
  }
}

// ---------------------------------------------------------------------------
// Tri
// ---------------------------------------------------------------------------

interface CleTri {
  cle: string
  desc: boolean
  comparer: (a: unknown, b: unknown) => number
}

function cleDeTriExplicite(
  tri: NonNullable<ContenuTableau['tri']>,
  parCle: Map<string, ColonneJeu>,
  locale: string
): CleTri[] {
  return tri
    .filter(t => parCle.has(t.cle))
    .map(t => ({
      cle: t.cle,
      desc: t.sens === 'desc',
      comparer: creerComparateur(parCle.get(t.cle)?.type, locale),
    }))
}

/**
 * Tri par défaut (règle de l'application) : les colonnes de DIMENSION affichées, de gauche à
 * droite ; texte de A à Z (`comparerLibelles`), période et date en ordre chronologique.
 */
function cleDeTriParDefaut(
  colonnes: ColonneModele[],
  parCle: Map<string, ColonneJeu>,
  locale: string
): CleTri[] {
  const cles: CleTri[] = []
  for (const colonne of colonnes) {
    if (colonne.type !== 'dimension') continue
    const type = parCle.get(colonne.id)?.type
    const chrono = type === 'date' || type === 'periode'
    cles.push({
      cle: colonne.id,
      desc: false,
      comparer: chrono
        ? (a, b) => {
            const sa = String(a)
            const sb = String(b)
            return sa < sb ? -1 : sa > sb ? 1 : 0
          }
        : (a, b) => comparerLibelles(a, b, locale),
    })
  }
  return cles
}

/**
 * Ordre du jeu (classement par valeur, Top N) : mesures comparees comme des nombres, dimensions
 * selon leur regle habituelle. Les cles inconnues du jeu sont ignorees.
 */
function cleDeTriDeLOrdre(
  ordre: NonNullable<JeuClient['provenance']['ordre']>,
  parCle: Map<string, ColonneJeu>,
  locale: string
): CleTri[] {
  const connues = ordre.filter(o => parCle.has(o.cle))
  return connues.map(o => {
    const type = parCle.get(o.cle)?.type
    const chrono = type === 'date' || type === 'periode'
    const numerique = estFormatNumerique(type)
    return {
      cle: o.cle,
      desc: o.sens === 'desc',
      comparer: numerique
        ? (a, b) => (enNombre(a) ?? 0) - (enNombre(b) ?? 0)
        : chrono
          ? (a, b) => {
              const sa = String(a)
              const sb = String(b)
              return sa < sb ? -1 : sa > sb ? 1 : 0
            }
          : (a, b) => comparerLibelles(a, b, locale),
    }
  })
}

function trier(
  lignes: Record<string, unknown>[],
  jeu: JeuClient,
  tri: ContenuTableau['tri'],
  colonnes: ColonneModele[],
  locale: string,
  ordre?: JeuClient['provenance']['ordre']
): Record<string, unknown>[] {
  const parCle = new Map(jeu.colonnes.map(c => [c.cle, c]))
  // Un `spec.tri` présent l'emporte tel quel (même sans clé connue : ordre d'origine).
  // Sans `spec.tri`, un jeu classé par valeur (Top N) garde son ordre ; sinon tri par libellé.
  const cleOrdre = ordre && ordre.length > 0 ? cleDeTriDeLOrdre(ordre, parCle, locale) : []
  const cles =
    tri && tri.length > 0
      ? cleDeTriExplicite(tri, parCle, locale)
      : cleOrdre.length > 0
        ? [...cleOrdre, ...cleDeTriParDefaut(colonnes, parCle, locale)]
        : cleDeTriParDefaut(colonnes, parCle, locale)
  if (cles.length === 0) return lignes
  const vide = (v: unknown) => v === null || v === undefined || v === ''
  // Array.prototype.sort est stable (ES2019) ; copie pour ne pas muter l'entrée.
  return [...lignes].sort((a, b) => {
    for (const k of cles) {
      const va = a[k.cle]
      const vb = b[k.cle]
      // Les valeurs absentes restent en dernier, quel que soit le sens.
      if (vide(va) || vide(vb)) {
        if (vide(va) && vide(vb)) continue
        return vide(va) ? 1 : -1
      }
      const r = k.comparer(va, vb)
      if (r !== 0) return k.desc ? -r : r
    }
    return 0
  })
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function construireModeleTableau(
  jeu: JeuClient,
  spec: ContenuTableau,
  options: OptionsModeleTableau
): ModeleTableau {
  const source = jeu.lignes ?? []
  const { lignes: filtrees, actifs } = appliquerFiltres(source, jeu, spec.filtres)

  if (spec.pivot) {
    const formats: Record<string, FormatColonne> = {}
    for (const c of spec.colonnes ?? []) if (c.format) formats[c.cle] = c.format
    const modele = calculerPivot(filtrees, jeu.colonnes, spec.pivot, {
      locale: options.locale,
      totaux: !!spec.totaux,
      formats,
      libelleAgregat: options.libelleAgregat,
    })
    return { ...modele, nbLignesSource: source.length, nbLignesFiltrees: filtrees.length }
  }

  const colonnes = construireColonnes(jeu, spec)
  const triees = trier(filtrees, jeu, spec.tri, colonnes, options.locale, jeu.provenance?.ordre)
  const lignes = triees.map(l => {
    const out: Record<string, unknown> = {}
    for (const c of colonnes) out[c.id] = l[c.id] === undefined ? null : l[c.id]
    return out
  })

  let totaux: Record<string, unknown> | null = null
  if (spec.totaux) {
    totaux = {}
    const typeJeu = new Map(jeu.colonnes.map(col => [col.cle, col.type]))
    // Jeu limité (Top N) : le total est celui des lignes affichées, jamais celui du jeu entier
    // (écran et exports passent par ce même modèle). Un taux n'a alors ni numérateur ni
    // dénominateur : cellule vide.
    const limite = (jeu.provenance?.ordre?.length ?? 0) > 0 && jeu.tronque
    for (const c of colonnes) {
      // Un taux n'est jamais une somme de taux : le serveur calcule le rapport des sommes
      // (Σ réalisé ÷ Σ budget × 100) sur tout le jeu. Il n'est valable que sans filtre actif ;
      // sinon le jeu ne dit pas quel est le numérateur ni le dénominateur : la cellule reste vide.
      if (c.format === 'pourcentage' && typeJeu.get(c.id) === 'pourcentage') {
        if (limite) {
          totaux[c.id] = null
          continue
        }
        const rapport = jeu.totaux?.[c.id]
        totaux[c.id] =
          actifs === 0 && estNombreAnalytique(rapport) ? rapport : null
        continue
      }
      if (!estFormatAdditif(c.format)) {
        totaux[c.id] = null
        continue
      }
      // Les totaux serveur couvrent tout le jeu : valables seulement sans filtre et si tronqué.
      const serveur = jeu.totaux?.[c.id]
      if (!limite && actifs === 0 && (jeu.tronque || estDecimalExact(serveur)) && estNombreAnalytique(serveur)) {
        totaux[c.id] = serveur
        continue
      }
      const valeurs: NombreAnalytique[] = []
      for (const l of triees) {
        const valeur = l[c.id]
        const n = estDecimalExact(valeur) ? valeur : enNombre(valeur)
        if (n !== null) valeurs.push(n)
      }
      totaux[c.id] = valeurs.length ? sommerDecimaux(valeurs) : null
    }
  }

  return {
    colonnes,
    lignes,
    totaux,
    estPivot: false,
    nbLignesSource: source.length,
    nbLignesFiltrees: filtrees.length,
  }
}
