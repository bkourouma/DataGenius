/**
 * Jetons de couleur des graphiques Medic Assist (clair et sombre).
 *
 * Les valeurs viennent de DESIGN.md (cobalt, teal, ink, hairline, vert / ocre / oxyde d'état).
 *
 * Raisonnement de la palette catégorielle (10 teintes) :
 * - la charte dit « une couleur d'état = un état » : vert (#1f6f3a), ocre (#e19909) et oxyde
 *   (#b82d1e) ne servent JAMAIS à distinguer des catégories ; ils ne colorent que les seuils
 *   de la jauge (< 70 % oxyde, 70-90 % ocre, >= 90 % vert) et les marques de dépassement ;
 * - on part donc du cobalt et du teal du thème, puis de bleus / ardoises de luminosités
 *   différentes, et de quelques teintes désaturées (mauve, argile, rose poussière, indigo,
 *   taupe) loin du vert, de l'ocre et du rouge vif ;
 * - toutes les teintes claires ont un contraste >= 3:1 sur le blanc (testé), les teintes
 *   sombres >= 3:1 sur le fond sombre (testé) ;
 * - l'ordre alterne chaud / froid / clair / foncé entre voisins ; le sens n'est de toute façon
 *   jamais porté par la couleur seule (motifs `aria.decal` dès deux séries, légende).
 * - au-delà de 10 séries, les couleurs se répètent (le graphique impose par ailleurs top N).
 *
 * Thème sombre : l'application a une classe `.dark` dans globals.css mais ni `next-themes` ni
 * bascule branchée ; la variante sombre est fournie par cohérence (le contexte porte `theme`).
 */

import { SEUIL_TAUX_ALERTE, SEUIL_TAUX_ATTEINT } from '@/lib/reports/seuils-objectifs'

export type ThemeGraphique = 'clair' | 'sombre'

export { SEUIL_TAUX_ALERTE, SEUIL_TAUX_ATTEINT }

/** Police de la charte ; arabe, chinois et hindi retombent sur system-ui. */
export const FAMILLE_POLICE = 'Public Sans, system-ui, Segoe UI, Arial, sans-serif'

export interface JetonsGraphique {
  fond: string
  panneau: string
  encre: string
  encreAttenue: string
  quadrillage: string
  trait: string
  cobalt: string
  cobaltFocus: string
  /** Texte posé sur une couleur de série (étiquette de treemap, d'entonnoir). */
  surSerie: string
  etat: { atteint: string; enCours: string; aRisque: string }
  /** Dépassement d'un objectif ou d'un seuil. */
  depassement: string
  /** Rampe de la carte de chaleur : une seule teinte, claire vers foncée. */
  rampe: [string, string]
  infobulle: { fond: string; bordure: string; texte: string }
}

const CLAIR: JetonsGraphique = {
  fond: '#ffffff',
  panneau: '#ffffff',
  encre: '#111b2c',
  encreAttenue: '#4d596a',
  quadrillage: '#d4dbe2',
  trait: '#95a1b2',
  cobalt: '#0f4ca9',
  cobaltFocus: '#1061da',
  surSerie: '#ffffff',
  etat: { atteint: '#1f6f3a', enCours: '#e19909', aRisque: '#b82d1e' },
  depassement: '#b82d1e',
  rampe: ['#eaeff6', '#0f4ca9'],
  infobulle: { fond: '#ffffff', bordure: '#d4dbe2', texte: '#111b2c' },
}

const SOMBRE: JetonsGraphique = {
  fond: '#16233a',
  panneau: '#16233a',
  encre: '#e4eaf1',
  encreAttenue: '#9aabc1',
  quadrillage: '#253756',
  trait: '#5f7191',
  cobalt: '#6ea0ee',
  cobaltFocus: '#1061da',
  surSerie: '#0d1c36',
  etat: { atteint: '#4ade80', enCours: '#e19909', aRisque: '#ef7a6b' },
  depassement: '#ef7a6b',
  rampe: ['#1b2e4d', '#6ea0ee'],
  infobulle: { fond: '#0d1c36', bordure: '#253756', texte: '#e4eaf1' },
}

const SERIES_CLAIR = [
  '#0f4ca9', // cobalt
  '#136572', // info-teal
  '#7a4f87', // mauve
  '#a0663a', // argile
  '#3f86b5', // bleu ciel
  '#5b6878', // ardoise
  '#4b4ba0', // indigo
  '#a35d7a', // rose poussière
  '#6b7fa3', // bleu gris
  '#8f7a5a', // taupe
] as const

const SERIES_SOMBRE = [
  '#6ea0ee',
  '#4cb5c4',
  '#c49ad0',
  '#d09a6e',
  '#7cbbe0',
  '#a3afbd',
  '#9a9aea',
  '#e09ab5',
  '#9fb2d3',
  '#c2ad8a',
] as const

export const NB_COULEURS_SERIES = SERIES_CLAIR.length

/** Jetons du thème (objet partagé : ne pas le muter). */
export function jetons(theme: ThemeGraphique): JetonsGraphique {
  return theme === 'sombre' ? SOMBRE : CLAIR
}

/** Couleur de la série d'indice i (0 = première), cyclique au-delà de 10. */
export function couleurSerie(i: number, theme: ThemeGraphique): string {
  const liste = theme === 'sombre' ? SERIES_SOMBRE : SERIES_CLAIR
  const rang = ((Math.trunc(i) % liste.length) + liste.length) % liste.length
  return liste[rang]
}

export function couleursSeries(n: number, theme: ThemeGraphique): string[] {
  return Array.from({ length: Math.max(0, Math.trunc(n)) }, (_, i) => couleurSerie(i, theme))
}

/** Couleur d'état d'un taux en points (seuils 70 / 90 de l'application). */
export function couleurEtatTaux(taux: number, theme: ThemeGraphique): string {
  const { etat } = jetons(theme)
  if (taux < SEUIL_TAUX_ALERTE) return etat.aRisque
  if (taux < SEUIL_TAUX_ATTEINT) return etat.enCours
  return etat.atteint
}

/** Interpolation linéaire entre deux couleurs `#rrggbb` (t dans [0, 1]). */
export function melanger(a: string, b: string, t: number): string {
  const p = (c: string, k: number) => parseInt(c.slice(1 + 2 * k, 3 + 2 * k), 16)
  const u = Math.min(1, Math.max(0, t))
  const h = (k: number) =>
    Math.round(p(a, k) + (p(b, k) - p(a, k)) * u)
      .toString(16)
      .padStart(2, '0')
  return `#${h(0)}${h(1)}${h(2)}`
}

/** Luminance relative WCAG d'une couleur `#rrggbb`. */
export function luminance(couleur: string): number {
  const canal = (k: number) => {
    const v = parseInt(couleur.slice(1 + 2 * k, 3 + 2 * k), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2)
}

/** Rapport de contraste WCAG entre deux couleurs `#rrggbb`. */
export function contraste(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

