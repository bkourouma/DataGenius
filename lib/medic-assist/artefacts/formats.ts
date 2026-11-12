/**
 * Formats de colonnes (FormatColonne) vers Intl, selon la langue.
 *
 * Module pur et isomorphe (navigateur, serveur, export). Conventions :
 * - montant : euros (EUR), sans décimale pour un entier ou à partir de 1 000, deux sinon ;
 * - montant_compact : « 1,2 M€ », « 340 k€ » (notation compacte d'Intl) ;
 * - pourcentage : la valeur est en POINTS (85 = « 85 % »), comme `tauxDeRealisation` ;
 * - date : `YYYY-MM-DD` ; periode : `YYYY-MM` (mois et année) ;
 * - nombres : balise Intl de la langue (`toIntlTag`), chiffres latins pour l'arabe.
 * Une valeur absente (null, undefined, chaîne vide) donne une chaîne vide.
 */

import { toIntlTag } from '@/i18n/config'

import type { ColonneJeu, FormatColonne } from '@/lib/medic-assist/contrats'

export type FormateurValeur = (valeur: unknown) => string

export interface OptionsFormateur {
  /** Unité de la colonne (`ColonneJeu.unite`), ajoutée aux entiers et décimaux. */
  unite?: string
  /** Décimales forcées pour decimal et pourcentage (défaut : 2 et 1). */
  decimales?: number
}

/** Format par défaut d'une colonne du jeu : son type. */
export function formatParDefaut(colonne: Pick<ColonneJeu, 'type'>): FormatColonne {
  return colonne.type
}

/** Vrai pour les formats numériques (alignés à droite, additionnables). */
export function estFormatNumerique(format: FormatColonne | undefined): boolean {
  return (
    format === 'entier' ||
    format === 'decimal' ||
    format === 'montant' ||
    format === 'montant_compact' ||
    format === 'pourcentage'
  )
}

/** Convertit une cellule en nombre fini, ou null. Accepte les chaînes numériques. */
export function enNombre(valeur: unknown): number | null {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null
  if (typeof valeur === 'string' && valeur.trim() !== '') {
    const n = Number(valeur)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function estVide(valeur: unknown): boolean {
  return valeur === null || valeur === undefined || valeur === ''
}

const cacheNombres = new Map<string, Intl.NumberFormat>()
function nombre(tag: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cle = `${tag}|${JSON.stringify(options)}`
  let f = cacheNombres.get(cle)
  if (!f) {
    f = new Intl.NumberFormat(tag, options)
    cacheNombres.set(cle, f)
  }
  return f
}

const cacheDates = new Map<string, Intl.DateTimeFormat>()
function date(tag: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cle = `${tag}|${JSON.stringify(options)}`
  let f = cacheDates.get(cle)
  if (!f) {
    f = new Intl.DateTimeFormat(tag, options)
    cacheDates.set(cle, f)
  }
  return f
}

/** `YYYY-MM-DD` (ou ISO complet) vers un Date UTC, ou null. */
function dateUtc(valeur: unknown): Date | null {
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur
  if (typeof valeur !== 'string') return null
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(valeur)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Formateur d'une valeur selon `format` (absent : texte) et la langue.
 * Toujours sûr : une valeur illisible est rendue telle quelle, sans exception.
 */
export function creerFormateur(
  format: FormatColonne | undefined,
  locale: string,
  options: OptionsFormateur = {}
): FormateurValeur {
  const tag = toIntlTag(locale)
  const unite = options.unite?.trim()
  const avecUnite = (texte: string) => (unite ? `${texte} ${unite}` : texte)

  switch (format) {
    case 'entier':
      return v => {
        const n = enNombre(v)
        if (n === null) return estVide(v) ? '' : String(v)
        return avecUnite(nombre(tag, { maximumFractionDigits: 0 }).format(n))
      }
    case 'decimal':
      return v => {
        const n = enNombre(v)
        if (n === null) return estVide(v) ? '' : String(v)
        const dec = options.decimales ?? 2
        return avecUnite(
          nombre(tag, { minimumFractionDigits: 0, maximumFractionDigits: dec }).format(n)
        )
      }
    case 'montant':
      return v => {
        const n = enNombre(v)
        if (n === null) return estVide(v) ? '' : String(v)
        const sansDecimale = Number.isInteger(n) || Math.abs(n) >= 1000
        return nombre(tag, {
          style: 'currency',
          currency: 'EUR',
          minimumFractionDigits: sansDecimale ? 0 : 2,
          maximumFractionDigits: sansDecimale ? 0 : 2,
        }).format(n)
      }
    case 'montant_compact':
      return v => {
        const n = enNombre(v)
        if (n === null) return estVide(v) ? '' : String(v)
        return nombre(tag, {
          style: 'currency',
          currency: 'EUR',
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(n)
      }
    case 'pourcentage':
      return v => {
        const n = enNombre(v)
        if (n === null) return estVide(v) ? '' : String(v)
        const dec = options.decimales ?? 1
        return nombre(tag, {
          style: 'percent',
          minimumFractionDigits: dec,
          maximumFractionDigits: dec,
        }).format(n / 100)
      }
    case 'date':
      return v => {
        const d = dateUtc(v)
        if (!d) return estVide(v) ? '' : String(v)
        return date(tag, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d)
      }
    case 'periode':
      return v => {
        const d = dateUtc(v)
        if (!d) return estVide(v) ? '' : String(v)
        return date(tag, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
      }
    case 'texte':
    default:
      return v => (estVide(v) ? '' : String(v))
  }
}

/** Formateur d'une colonne du jeu, le format imposé par l'artefact l'emportant. */
export function formateurColonne(
  colonne: ColonneJeu,
  locale: string,
  formatImpose?: FormatColonne
): FormateurValeur {
  const format = formatImpose ?? formatParDefaut(colonne)
  return creerFormateur(format, locale, { unite: colonne.unite })
}

/** Formateur compact pour les axes de graphique (k, M ; pourcentage sans décimale). */
export function creerFormateurAxe(format: FormatColonne | undefined, locale: string): FormateurValeur {
  const tag = toIntlTag(locale)
  switch (format) {
    case 'montant':
    case 'montant_compact':
      return v => {
        const n = enNombre(v)
        return n === null ? '' : nombre(tag, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(n)
      }
    case 'pourcentage':
      return v => {
        const n = enNombre(v)
        return n === null ? '' : nombre(tag, { style: 'percent', maximumFractionDigits: 0 }).format(n / 100)
      }
    case 'entier':
    case 'decimal':
      return v => {
        const n = enNombre(v)
        return n === null ? '' : nombre(tag, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
      }
    default:
      return creerFormateur(format, locale)
  }
}
