/**
 * Construction commune d'une feuille tabulaire (Excel et CSV) a partir de cellules
 * brutes : detection de la ligne d'en-tete, cles de colonnes, types, valeurs.
 * Fonctions pures, sans acces disque ni base.
 */

import type { Cellule, ColonneJeu, LigneJeu, TypeColonne } from '../imports-lot0'
import { PLAFONDS, type FeuilleExtraite } from '../types'

/**
 * Cellule lue dans un fichier, avant typage.
 *  - 'brut'   : texte tel que lu (CSV, ou texte Excel) : le typage le deduit ;
 *  - 'nombre' : nombre Excel, avec son format d'affichage (pourcentage, monnaie) ;
 *  - 'date'   : date deja normalisee en AAAA-MM-JJ ;
 *  - 'booleen'.
 */
export type CelluleBrute =
  | { genre: 'vide' }
  | { genre: 'brut'; texte: string }
  | { genre: 'nombre'; nombre: number; format?: string }
  | { genre: 'date'; iso: string }
  | { genre: 'booleen'; valeur: boolean }

export const CELLULE_VIDE: CelluleBrute = { genre: 'vide' }

type Lecture =
  | { genre: 'vide' }
  | { genre: 'entier' | 'decimal'; valeur: number }
  | { genre: 'pourcentage'; valeur: number }
  | { genre: 'montant'; valeur: number; unite?: string }
  | { genre: 'date'; valeur: string }
  | { genre: 'periode'; valeur: string }
  | { genre: 'booleen'; valeur: boolean }
  | { genre: 'texte'; valeur: string }

const ESPACES_MILLIERS = /[   ]/g
const SYMBOLES_MONNAIE: Record<string, string | undefined> = { '€': 'EUR', $: 'USD', '£': 'GBP' }

function arrondir(valeur: number): number {
  return Math.round(valeur * 1e9) / 1e9
}

function dateIso(annee: number, mois: number, jour: number): string | null {
  if (annee < 1000 || annee > 9999 || mois < 1 || mois > 12 || jour < 1) return null
  const d = new Date(Date.UTC(annee, mois - 1, jour))
  if (d.getUTCFullYear() !== annee || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) {
    return null
  }
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}

/**
 * Nombre ecrit en texte : « 1 234,56 », « 1,234.56 », « -12.5 », « 1234 ». Rend null si le
 * texte n'est pas un nombre sur. Une virgule seule est decimale (« 1,234 » = 1,234).
 * Les codes a zero initial (« 007 ») et les suites de plus de 15 chiffres restent du texte.
 */
export function nombreDepuisTexte(texte: string): { valeur: number; entier: boolean } | null {
  let s = texte.replace(ESPACES_MILLIERS, '')
  if (!/^[-+]?(\d+([.,]\d+)?|\d{1,3}([.,]\d{3})+([.,]\d+)?)$/.test(s)) return null

  const signe = s.startsWith('-') ? -1 : 1
  s = s.replace(/^[-+]/, '')
  const virgule = s.lastIndexOf(',')
  const point = s.lastIndexOf('.')
  let decimal = false
  if (virgule >= 0 && point >= 0) {
    // Les deux presents : le dernier est le separateur decimal, l'autre separe les milliers.
    const sepDecimal = virgule > point ? ',' : '.'
    const sepMille = sepDecimal === ',' ? '.' : ','
    s = s.split(sepMille).join('').replace(sepDecimal, '.')
    decimal = true
  } else if (virgule >= 0 || point >= 0) {
    const sep = virgule >= 0 ? ',' : '.'
    if (s.split(sep).length > 2) return null // « 1.234.567 » : ambigu, laisse en texte
    s = s.replace(sep, '.')
    decimal = true
  }
  const partieEntiere = s.split('.')[0]
  if (partieEntiere.length > 1 && partieEntiere.startsWith('0') && !decimal) return null
  if (s.replace('.', '').length > 15) return null
  const valeur = Number(s) * signe
  if (!Number.isFinite(valeur)) return null
  return { valeur, entier: !decimal }
}

/** Interprete un texte : nombre, pourcentage, montant, date, periode ; sinon texte. */
export function lireTexte(brut: string): Lecture {
  const texte = brut.trim()
  if (texte === '') return { genre: 'vide' }

  const nombre = nombreDepuisTexte(texte)
  if (nombre) return { genre: nombre.entier ? 'entier' : 'decimal', valeur: nombre.valeur }

  const pct = /^(.+?)\s*%$/.exec(texte)
  if (pct) {
    const n = nombreDepuisTexte(pct[1])
    if (n) return { genre: 'pourcentage', valeur: n.valeur }
  }

  const monnaie = /^(.+?)\s*([€$£])$|^([€$£])\s*(.+)$/.exec(texte)
  if (monnaie) {
    const symbole = monnaie[2] ?? monnaie[3]
    const n = nombreDepuisTexte(monnaie[1] ?? monnaie[4])
    if (n) return { genre: 'montant', valeur: n.valeur, unite: SYMBOLES_MONNAIE[symbole] }
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(texte)
  if (iso) {
    const d = dateIso(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    if (d) return { genre: 'date', valeur: d }
  }
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(texte)
  if (fr) {
    const d = dateIso(Number(fr[3]), Number(fr[2]), Number(fr[1]))
    if (d) return { genre: 'date', valeur: d }
  }

  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(texte)) return { genre: 'periode', valeur: texte }

  return { genre: 'texte', valeur: texte.slice(0, PLAFONDS.caracteresCelluleMax) }
}

const FORMAT_MONNAIE = /[€$£]|\[\$|\bEUR\b|\bUSD\b|\bGBP\b|FCFA|\bXOF\b|\bXAF\b/i

function uniteDuFormat(format: string): string | undefined {
  if (format.includes('€') || /\bEUR\b/i.test(format)) return 'EUR'
  if (format.includes('$') || /\bUSD\b/i.test(format)) return 'USD'
  if (format.includes('£') || /\bGBP\b/i.test(format)) return 'GBP'
  return undefined
}

function lire(cellule: CelluleBrute): Lecture {
  switch (cellule.genre) {
    case 'vide':
      return { genre: 'vide' }
    case 'brut':
      return lireTexte(cellule.texte)
    case 'date':
      return { genre: 'date', valeur: cellule.iso }
    case 'booleen':
      return { genre: 'booleen', valeur: cellule.valeur }
    case 'nombre': {
      const format = cellule.format ?? ''
      if (format.includes('%')) {
        return { genre: 'pourcentage', valeur: arrondir(cellule.nombre * 100) }
      }
      if (FORMAT_MONNAIE.test(format)) {
        return { genre: 'montant', valeur: cellule.nombre, unite: uniteDuFormat(format) }
      }
      return {
        genre: Number.isInteger(cellule.nombre) ? 'entier' : 'decimal',
        valeur: cellule.nombre,
      }
    }
  }
}

/** Texte d'une cellule d'en-tete ou d'une cellule d'une colonne texte. */
function texteDe(cellule: CelluleBrute, lecture: Lecture): string {
  if (cellule.genre === 'brut') return cellule.texte.trim().slice(0, PLAFONDS.caracteresCelluleMax)
  if (lecture.genre === 'vide') return ''
  if (cellule.genre === 'nombre') return String(cellule.nombre)
  return String((lecture as { valeur: unknown }).valeur)
}

/** Une cellule est « du texte » (pour reperer l'en-tete) si ce n'est ni un nombre ni une date. */
function estTexte(cellule: CelluleBrute): boolean {
  const l = lire(cellule)
  return l.genre === 'texte' || l.genre === 'periode'
}

function estVide(cellule: CelluleBrute): boolean {
  return lire(cellule).genre === 'vide'
}

function nbNonVides(ligne: CelluleBrute[]): number {
  return ligne.reduce((n, c) => n + (estVide(c) ? 0 : 1), 0)
}

/**
 * Ligne d'en-tete parmi les 20 premieres : la premiere dont au moins 60 % des cellules non
 * vides sont du texte, qui est assez large (pas un titre isole) et qui est suivie d'une ligne
 * de donnees. Sinon la ligne 1. Rend un indice 0-based.
 */
export function detecterEntete(lignes: CelluleBrute[][]): number {
  const fenetre = lignes.slice(0, PLAFONDS.lignesRechercheEntete)
  const largeur = Math.max(0, ...fenetre.map(nbNonVides))
  const minimum = largeur >= 2 ? Math.max(2, Math.ceil(largeur / 2)) : 1

  for (let i = 0; i < fenetre.length; i++) {
    const ligne = fenetre[i]
    const remplies = ligne.filter(c => !estVide(c))
    if (remplies.length < minimum) continue
    const textes = remplies.filter(estTexte).length
    if (textes / remplies.length < 0.6) continue
    const suivante = lignes.slice(i + 1).find(l => nbNonVides(l) > 0)
    if (!suivante) continue
    return i
  }
  return 0
}

function cleDepuis(libelle: string, position: number, prises: Set<string>): string {
  let base = libelle
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (base === '') base = `colonne_${position}`
  if (/^[0-9]/.test(base)) base = `c_${base}`
  base = base.slice(0, 60)
  let cle = base
  for (let n = 2; prises.has(cle); n++) cle = `${base}_${n}`
  prises.add(cle)
  return cle
}

function typeDe(lectures: Lecture[]): { type: TypeColonne; unite?: string } {
  const genres = new Set(lectures.filter(l => l.genre !== 'vide').map(l => l.genre))
  if (genres.size === 0) return { type: 'texte' }
  const dans = (...autorises: string[]) => [...genres].every(g => autorises.includes(g))

  if (dans('entier')) return { type: 'entier' }
  if (dans('entier', 'decimal')) return { type: 'decimal' }
  if (dans('pourcentage')) return { type: 'pourcentage', unite: '%' }
  if (genres.has('montant') && dans('montant', 'entier', 'decimal')) {
    const unites = new Set(
      lectures.filter(l => l.genre === 'montant').map(l => (l as { unite?: string }).unite)
    )
    const unite = unites.size === 1 ? [...unites][0] : undefined
    return unite ? { type: 'montant', unite } : { type: 'montant' }
  }
  if (dans('date')) return { type: 'date' }
  if (dans('periode')) return { type: 'periode' }
  return { type: 'texte' }
}

function valeurTypee(cellule: CelluleBrute, lecture: Lecture, type: TypeColonne, preserverTexte = false): Cellule {
  if (lecture.genre === 'vide') return null
  if (type === 'texte') {
    if (preserverTexte && cellule.genre === 'brut') return cellule.texte
    return lecture.genre === 'booleen' ? lecture.valeur : texteDe(cellule, lecture)
  }
  return (lecture as { valeur: Cellule }).valeur
}

export interface EntreeFeuille {
  nom: string
  preserverTexte?: boolean
  /** Lignes lues, titres inclus, depuis le debut de la feuille. */
  lignes: CelluleBrute[][]
  /** Numero de ligne de la feuille pour chaque ligne de `lignes` (1 = premiere). */
  numeros: number[]
  /** Numero de colonne de la feuille pour chaque position de ligne. */
  indexColonnes: number[]
  /** Nombre total de lignes de la feuille (en-tete et titres compris, au-dela de `lignes` aussi). */
  nbLignesTotal: number
  /** Vrai si la feuille a plus de lignes que celles fournies. */
  coupe: boolean
}

/** Feuille vide : aucune colonne. */
function feuilleVide(entree: EntreeFeuille): FeuilleExtraite {
  return {
    nom: entree.nom,
    colonnes: [],
    lignes: [],
    ligneEntete: 1,
    nbLignesVues: 0,
    tronque: false,
    indexColonnes: [],
    numerosLignes: [],
  }
}

export function construireFeuille(entree: EntreeFeuille): FeuilleExtraite {
  const { lignes } = entree
  if (lignes.every(l => nbNonVides(l) === 0)) return feuilleVide(entree)

  const iEntete = detecterEntete(lignes)
  const entete = lignes[iEntete]
  const donnees: { cellules: CelluleBrute[]; numero: number }[] = []
  for (let i = iEntete + 1; i < lignes.length; i++) {
    if (nbNonVides(lignes[i]) === 0) continue
    donnees.push({ cellules: lignes[i], numero: entree.numeros[i] })
  }
  const depasse = donnees.length > PLAFONDS.lignesDonneesMax
  const retenues = donnees.slice(0, PLAFONDS.lignesDonneesMax)

  // Colonnes vides en queue (ni en-tete ni donnee) ignorees.
  let derniere = -1
  for (let c = 0; c < entete.length; c++) {
    if (!estVide(entete[c]) || retenues.some(r => !estVide(r.cellules[c] ?? CELLULE_VIDE))) {
      derniere = c
    }
  }
  const nbColonnes = Math.min(derniere + 1, PLAFONDS.colonnesMax)

  const prises = new Set<string>()
  const colonnes: ColonneJeu[] = []
  const lecturesParColonne: Lecture[][] = []
  for (let c = 0; c < nbColonnes; c++) {
    const celluleEntete = entete[c] ?? CELLULE_VIDE
    const libelleLu = texteDe(celluleEntete, lire(celluleEntete)).replace(/\s+/g, ' ').trim()
    const position = entree.indexColonnes[c] ?? c + 1
    const cle = cleDepuis(libelleLu, position, prises)
    const lectures = retenues.map(r => lire(r.cellules[c] ?? CELLULE_VIDE))
    const { type, unite } = typeDe(lectures)
    colonnes.push({
      cle,
      libelle: libelleLu || `Colonne ${position}`,
      type,
      ...(unite ? { unite } : {}),
    })
    lecturesParColonne.push(lectures)
  }

  const lignesJeu: LigneJeu[] = retenues.map((r, i) => {
    const ligne: LigneJeu = {}
    colonnes.forEach((col, c) => {
      ligne[col.cle] = valeurTypee(
        r.cellules[c] ?? CELLULE_VIDE,
        lecturesParColonne[c][i],
        col.type,
        entree.preserverTexte,
      )
    })
    return ligne
  })

  const nbLignesVues = Math.max(0, entree.nbLignesTotal - (iEntete + 1))
  return {
    nom: entree.nom,
    colonnes,
    lignes: lignesJeu,
    ligneEntete: entree.numeros[iEntete],
    nbLignesVues: Math.max(nbLignesVues, retenues.length),
    tronque: depasse || entree.coupe,
    indexColonnes: Array.from({ length: nbColonnes }, (_, c) => entree.indexColonnes[c] ?? c + 1),
    numerosLignes: retenues.map(r => r.numero),
  }
}
