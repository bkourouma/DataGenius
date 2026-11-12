/**
 * Tableau croisé (pivot) calculé côté client ou serveur, sans accès base ni React.
 *
 * Une seule passe sur les lignes source : chaque ligne alimente quatre accumulateurs
 * (cellule, total de ligne, total de colonne, total général). Les totaux de moyenne, min,
 * max et nombre sont donc calculés sur les LIGNES SOURCE (moyenne pondérée juste), jamais
 * comme une moyenne de moyennes.
 */

import { creerFormateur, enNombre, estFormatNumerique } from './formats'

import type {
  Agregat,
  ColonneJeu,
  FormatColonne,
  Pivot,
  TypeColonne,
} from '@/lib/medic-assist/contrats'
import type { ColonneModele, ModeleTableau } from './types-rendu'

export interface OptionsPivot {
  locale: string
  /** Colonnes « total » par mesure et ligne de totaux en bas. */
  totaux: boolean
  /** Format imposé par colonne du jeu (clé de colonne vers format). */
  formats?: Record<string, FormatColonne>
  /** Libellé d'un agrégat (traduit par l'appelant). Absent : le code de l'agrégat. */
  libelleAgregat?: (agregat: Agregat) => string
}

/** Séparateur des niveaux d'en-tête dans `ColonneModele.libelle`. */
export const SEPARATEUR_ENTETE = ' · '

// ---------------------------------------------------------------------------
// Comparaison (partagée avec le tri du tableau)
// ---------------------------------------------------------------------------

export type Comparateur = (a: unknown, b: unknown) => number

function estVide(valeur: unknown): boolean {
  return valeur === null || valeur === undefined || valeur === ''
}

const cacheCollators = new Map<string, Intl.Collator>()

/** Collator de la langue : chiffres comparés comme des nombres, casse et accents ignorés. */
export function collatorDe(locale: string): Intl.Collator {
  let c = cacheCollators.get(locale)
  if (!c) {
    try {
      c = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
    } catch {
      c = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' })
    }
    cacheCollators.set(locale, c)
  }
  return c
}

/**
 * Comparateur croissant d'une dimension : vide toujours en dernier, dates et périodes en
 * ordre chronologique (comparaison de chaînes ISO), nombres numériquement, textes au collator.
 * Le vide reste en dernier même si l'appelant inverse le sens (voir `sensInverse`).
 */
export function creerComparateur(type: TypeColonne | undefined, locale: string): Comparateur {
  const collator = collatorDe(locale)
  const chrono = type === 'date' || type === 'periode'
  const numerique = type !== undefined && estFormatNumerique(type)
  return (a, b) => {
    const va = estVide(a)
    const vb = estVide(b)
    if (va || vb) return va === vb ? 0 : va ? 1 : -1
    if (numerique) {
      const na = enNombre(a)
      const nb = enNombre(b)
      if (na !== null && nb !== null) return na - nb
    }
    const sa = String(a)
    const sb = String(b)
    if (chrono) return sa < sb ? -1 : sa > sb ? 1 : 0
    return collator.compare(sa, sb)
  }
}

// ---------------------------------------------------------------------------
// Accumulateurs
// ---------------------------------------------------------------------------

interface Acc {
  /** Lignes vues. */
  l: number
  /** Cellules non vides. */
  c: number
  /** Cellules numériques. */
  n: number
  s: number
  mn: number
  mx: number
}

function nouvelAcc(): Acc {
  return { l: 0, c: 0, n: 0, s: 0, mn: Infinity, mx: -Infinity }
}

function ajouter(acc: Acc, brut: unknown, nombre: number | null): void {
  acc.l += 1
  if (!estVide(brut)) acc.c += 1
  if (nombre !== null) {
    acc.n += 1
    acc.s += nombre
    if (nombre < acc.mn) acc.mn = nombre
    if (nombre > acc.mx) acc.mx = nombre
  }
}

function resultat(acc: Acc | undefined, agregat: Agregat): number | null {
  if (!acc || acc.l === 0) return null
  switch (agregat) {
    case 'nombre':
      return acc.c
    case 'somme':
      return acc.n > 0 ? acc.s : null
    case 'moyenne':
      return acc.n > 0 ? acc.s / acc.n : null
    case 'min':
      return acc.n > 0 ? acc.mn : null
    case 'max':
      return acc.n > 0 ? acc.mx : null
  }
}

const SEP_CLE = '\u0001'

function echapper(valeur: string): string {
  return valeur.replace(/[\\|]/g, '\\$&')
}

interface Mesure {
  cle: string
  agregat: Agregat
  colonne: ColonneJeu
  format: FormatColonne
  libelle: string
}

// ---------------------------------------------------------------------------
// Calcul
// ---------------------------------------------------------------------------

export function calculerPivot(
  lignes: Record<string, unknown>[],
  colonnesJeu: ColonneJeu[],
  pivot: Pivot,
  options: OptionsPivot
): ModeleTableau {
  const { locale, totaux: avecTotaux } = options
  const parCle = new Map(colonnesJeu.map(c => [c.cle, c]))

  // Clés inconnues ignorées (jamais d'exception).
  const dimsLignes = pivot.lignes.map(k => parCle.get(k)).filter((c): c is ColonneJeu => !!c)
  const dimsColonnes = pivot.colonnes.map(k => parCle.get(k)).filter((c): c is ColonneJeu => !!c)

  const agregatsParMesure = new Map<string, Set<Agregat>>()
  for (const v of pivot.valeurs) {
    if (!parCle.has(v.cle)) continue
    const set = agregatsParMesure.get(v.cle) ?? new Set<Agregat>()
    set.add(v.agregat)
    agregatsParMesure.set(v.cle, set)
  }

  const vues = new Set<string>()
  const mesures: Mesure[] = []
  for (const v of pivot.valeurs) {
    const colonne = parCle.get(v.cle)
    if (!colonne) continue
    const doublon = `${v.cle}|${v.agregat}`
    if (vues.has(doublon)) continue
    vues.add(doublon)
    let format: FormatColonne
    if (v.agregat === 'nombre') format = 'entier'
    else {
      const demande = options.formats?.[v.cle] ?? colonne.type
      format = estFormatNumerique(demande) ? demande : 'decimal'
    }
    const plusieurs = (agregatsParMesure.get(v.cle)?.size ?? 0) > 1
    const afficherAgregat = plusieurs || (!!options.libelleAgregat && v.agregat !== 'somme')
    const nomAgregat = options.libelleAgregat ? options.libelleAgregat(v.agregat) : v.agregat
    mesures.push({
      cle: v.cle,
      agregat: v.agregat,
      colonne,
      format,
      libelle: afficherAgregat ? `${colonne.libelle} (${nomAgregat})` : colonne.libelle,
    })
  }

  const nbMesures = mesures.length

  // --- Une passe sur les lignes -------------------------------------------
  interface LigneAcc {
    dims: unknown[]
    cellules: Map<string, Acc[]>
    total: Acc[]
  }
  interface ColonneAcc {
    valeurs: unknown[]
    total: Acc[]
  }
  const groupesLignes = new Map<string, LigneAcc>()
  const groupesColonnes = new Map<string, ColonneAcc>()
  const general: Acc[] = mesures.map(nouvelAcc)

  for (const ligne of lignes) {
    let cleLigne = ''
    for (let i = 0; i < dimsLignes.length; i++) {
      const v = ligne[dimsLignes[i].cle]
      cleLigne += (i ? SEP_CLE : '') + (estVide(v) ? '' : String(v))
    }
    let cleColonne = ''
    for (let i = 0; i < dimsColonnes.length; i++) {
      const v = ligne[dimsColonnes[i].cle]
      cleColonne += (i ? SEP_CLE : '') + (estVide(v) ? '' : String(v))
    }

    let g = groupesLignes.get(cleLigne)
    if (!g) {
      g = {
        dims: dimsLignes.map(d => (estVide(ligne[d.cle]) ? null : ligne[d.cle])),
        cellules: new Map(),
        total: mesures.map(nouvelAcc),
      }
      groupesLignes.set(cleLigne, g)
    }
    let c = groupesColonnes.get(cleColonne)
    if (!c) {
      c = {
        valeurs: dimsColonnes.map(d => (estVide(ligne[d.cle]) ? null : ligne[d.cle])),
        total: mesures.map(nouvelAcc),
      }
      groupesColonnes.set(cleColonne, c)
    }
    let cellule = g.cellules.get(cleColonne)
    if (!cellule) {
      cellule = mesures.map(nouvelAcc)
      g.cellules.set(cleColonne, cellule)
    }

    for (let m = 0; m < nbMesures; m++) {
      const brut = ligne[mesures[m].cle]
      const nombre = enNombre(brut)
      ajouter(cellule[m], brut, nombre)
      ajouter(g.total[m], brut, nombre)
      ajouter(c.total[m], brut, nombre)
      ajouter(general[m], brut, nombre)
    }
  }

  // --- Colonnes ------------------------------------------------------------
  const comparateursColonnes = dimsColonnes.map(d => creerComparateur(d.type, locale))
  const colonnesTriees = [...groupesColonnes.entries()].sort(([, a], [, b]) => {
    for (let i = 0; i < comparateursColonnes.length; i++) {
      const r = comparateursColonnes[i](a.valeurs[i], b.valeurs[i])
      if (r !== 0) return r
    }
    return 0
  })

  const formateursColonnes = dimsColonnes.map(d =>
    creerFormateur(options.formats?.[d.cle] ?? d.type, locale, { unite: d.unite })
  )

  const colonnesModele: ColonneModele[] = dimsLignes.map(d => ({
    id: d.cle,
    libelle: d.libelle,
    format: options.formats?.[d.cle] ?? d.type,
    type: 'dimension',
    alignement: 'start',
    unite: d.unite,
  }))

  // Id de colonne de valeur et lien vers l'accumulateur de colonne.
  const colonnesValeurs: { id: string; cleColonne: string; m: number }[] = []
  const aucuneDimColonne = dimsColonnes.length === 0

  for (const [cleColonne, groupe] of colonnesTriees) {
    const libelleDims = groupe.valeurs.map((v, i) => formateursColonnes[i](v))
    const idDims = groupe.valeurs.map(v => echapper(estVide(v) ? '' : String(v))).join('|')
    for (let m = 0; m < nbMesures; m++) {
      const mesure = mesures[m]
      const id = `v${m}|${idDims}|${echapper(mesure.cle)}|${mesure.agregat}`
      const entete = [...libelleDims, mesure.libelle]
      colonnesModele.push({
        id,
        libelle: entete.join(SEPARATEUR_ENTETE),
        entete,
        format: mesure.format,
        type: 'valeur',
        alignement: 'end',
        unite: mesure.colonne.unite,
      })
      colonnesValeurs.push({ id, cleColonne, m })
    }
  }
  // Sans donnée et sans dimension en colonnes, les mesures doivent tout de même exister.
  if (aucuneDimColonne && colonnesTriees.length === 0) {
    for (let m = 0; m < nbMesures; m++) {
      const mesure = mesures[m]
      const id = `v${m}||${echapper(mesure.cle)}|${mesure.agregat}`
      colonnesModele.push({
        id,
        libelle: mesure.libelle,
        entete: [mesure.libelle],
        format: mesure.format,
        type: 'valeur',
        alignement: 'end',
        unite: mesure.colonne.unite,
      })
      colonnesValeurs.push({ id, cleColonne: '', m })
    }
  }

  const totalSansSens = (m: number): boolean =>
    mesures[m].format === 'pourcentage' && mesures[m].agregat === 'somme'

  const colonnesTotal: { id: string; m: number }[] = []
  if (avecTotaux && !aucuneDimColonne) {
    for (let m = 0; m < nbMesures; m++) {
      const mesure = mesures[m]
      const id = `t|${m}|${echapper(mesure.cle)}|${mesure.agregat}`
      colonnesModele.push({
        id,
        libelle: mesure.libelle,
        entete: [mesure.libelle],
        format: mesure.format,
        type: 'total',
        alignement: 'end',
        unite: mesure.colonne.unite,
      })
      colonnesTotal.push({ id, m })
    }
  }

  // --- Lignes ---------------------------------------------------------------
  const comparateursLignes = dimsLignes.map(d => creerComparateur(d.type, locale))
  const groupesTries = [...groupesLignes.values()]
  if (dimsLignes.length > 0) {
    groupesTries.sort((a, b) => {
      for (let i = 0; i < comparateursLignes.length; i++) {
        const r = comparateursLignes[i](a.dims[i], b.dims[i])
        if (r !== 0) return r
      }
      return 0
    })
  }

  const lignesModele: Record<string, unknown>[] = groupesTries.map(g => {
    const out: Record<string, unknown> = {}
    dimsLignes.forEach((d, i) => {
      out[d.cle] = g.dims[i]
    })
    for (const cv of colonnesValeurs) {
      out[cv.id] = resultat(g.cellules.get(cv.cleColonne)?.[cv.m], mesures[cv.m].agregat)
    }
    for (const ct of colonnesTotal) {
      out[ct.id] = totalSansSens(ct.m) ? null : resultat(g.total[ct.m], mesures[ct.m].agregat)
    }
    return out
  })

  // --- Totaux ---------------------------------------------------------------
  let totauxModele: Record<string, unknown> | null = null
  if (avecTotaux) {
    const t: Record<string, unknown> = {}
    for (const d of dimsLignes) t[d.cle] = null
    for (const cv of colonnesValeurs) {
      const mesure = mesures[cv.m]
      if (totalSansSens(cv.m)) {
        t[cv.id] = null
      } else {
        const acc = aucuneDimColonne ? general[cv.m] : groupesColonnes.get(cv.cleColonne)?.total[cv.m]
        t[cv.id] = resultat(acc, mesure.agregat)
      }
    }
    for (const ct of colonnesTotal) {
      t[ct.id] = totalSansSens(ct.m) ? null : resultat(general[ct.m], mesures[ct.m].agregat)
    }
    totauxModele = t
  }

  return {
    colonnes: colonnesModele,
    lignes: lignesModele,
    totaux: totauxModele,
    estPivot: true,
    nbLignesSource: lignes.length,
    nbLignesFiltrees: lignes.length,
  }
}
