/**
 * Spécification de graphique + jeu de données vers option ECharts.
 *
 * Module pur et isomorphe : il ne produit qu'un objet (aucun import d'`echarts` à l'exécution).
 * L'option contient des fonctions de formatage, elle est consommée dans le même processus.
 *
 * Choix documentés :
 * - agrégation d'une catégorie : somme (entier, décimal, montant) ou moyenne (pourcentage) ;
 * - ordre par défaut (règle de tri A-Z de l'application) : abscisse catégorielle sans
 *   `trierPar`/`sens` → libellés de A à Z ; abscisse temporelle → chronologique ; classements
 *   (`FORMES_CLASSEMENT`) → valeur décroissante, égalités départagées par libellé ;
 * - top N (`limite`) : on garde les N premières catégories du tri (par défaut, les N plus
 *   grandes valeurs de la première mesure) ; le reste devient « Autres » pour les mesures
 *   additives, et est omis pour un pourcentage (hors classement, les N gardés sont ensuite
 *   remis de A à Z, « Autres » en dernier) ; en ordre chronologique on omet toujours
 *   (on garde alors les N périodes les plus récentes) ;
 * - `format` de la spec : s'applique aux mesures de l'axe de la première mesure (donc à toutes,
 *   hors `combine` où l'axe de droite garde le type de sa colonne) ;
 * - jauge : une seule mesure ; valeur = total du jeu (`jeu.totaux`), sinon l'unique ligne,
 *   sinon pas de valeur. Échelle 0-100 si pourcentage (zones 70 / 90 de l'application), sinon
 *   0 à 1,25 × valeur ; il n'y a pas d'objectif dans le contrat, on n'en invente pas ;
 * - `nuage` : les lignes sont tracées une à une (pas d'agrégation, pas de limite) ;
 * - chiffres tabulaires : ECharts (canvas) n'expose ni `fontVariantNumeric` ni
 *   `fontFeatureSettings` ; la police de la charte est donc seule utilisée et les infobulles
 *   (HTML) portent `font-variant-numeric: tabular-nums`.
 */

import type { ColonneJeu, FormatColonne, FormeGraphique, GraphiqueSpec } from '@/lib/medic-assist/contrats'
import { comparerLibelles } from '@/lib/tri/libelles'
import { creerFormateur, creerFormateurAxe, enNombre, formateurColonne } from './formats'
import type { FormateurValeur } from './formats'
import { valeurSansLigne } from './indicateurs'
import {
  FAMILLE_POLICE,
  SEUIL_TAUX_ALERTE,
  SEUIL_TAUX_ATTEINT,
  couleursSeries,
  couleurEtatTaux,
  jetons,
} from './palette'
import type {
  AvertissementGraphique,
  ContexteGraphique,
  JeuClient,
  OptionGraphique,
  ResultatOptionGraphique,
} from './types-rendu'

type Rec = Record<string, unknown>
type Ligne = Record<string, unknown>

/** Au-delà, secteurs et anneau ne sont plus lisibles. */
export const MAX_CATEGORIES_SECTEURS = 8
/** Au-delà de ce nombre de catégories, un curseur de zoom discret est proposé. */
export const SEUIL_ZOOM = 24
/** Étiquettes de valeur seulement jusqu'à ce nombre de marques. */
export const MAX_ETIQUETTES = 12
/** Jusqu'à ce nombre de catégories, toutes les étiquettes d'axe sont affichées. */
export const MAX_CATEGORIES_ETIQUETEES_AXE = 12
export const MAX_CELLULES_ETIQUETEES = 100

const FORMES_UNE_MESURE: readonly FormeGraphique[] = [
  'secteurs',
  'anneau',
  'treemap',
  'entonnoir',
  'jauge',
  'carte_chaleur',
  'nuage',
]
const FORMES_CLASSEMENT: readonly FormeGraphique[] = [
  'barres_horizontales',
  'secteurs',
  'anneau',
  'treemap',
  'entonnoir',
]

const CLE_AUTRES = '\u0000autres'

/** Échappe `& < > " '` : les libellés des données ne sont jamais interprétés comme du HTML. */
export function echapperHtml(texte: unknown): string {
  return String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Modèle intermédiaire
// ---------------------------------------------------------------------------

interface Mesure {
  cle: string
  nom: string
  colonne?: ColonneJeu
  format: FormatColonne
  additif: boolean
  axe: 'gauche' | 'droite'
  forme: 'barres' | 'lignes'
  formateur: FormateurValeur
}

interface Groupe {
  cle: string
  libelle: string
  lignes: Ligne[]
  autres?: boolean
}

interface SerieCalc {
  nom: string
  mesure: Mesure
  valeurs: (number | null)[]
}

function nombres(lignes: Ligne[], cle: string): number[] {
  const sortie: number[] = []
  for (const l of lignes) {
    const n = enNombre(l[cle])
    if (n !== null) sortie.push(n)
  }
  return sortie
}

function agreger(valeurs: number[], additif: boolean): number | null {
  if (valeurs.length === 0) return null
  const somme = valeurs.reduce((a, b) => a + b, 0)
  return additif ? somme : somme / valeurs.length
}

function valeurGroupe(g: Groupe, m: Mesure, lignes: Ligne[] = g.lignes): number | null {
  if (g.autres && !m.additif) return null
  return agreger(nombres(lignes, m.cle), m.additif)
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

export function construireOptionGraphique(
  spec: GraphiqueSpec,
  jeu: JeuClient,
  contexte: ContexteGraphique
): ResultatOptionGraphique {
  const { traduire, locale } = contexte
  const avertissements: AvertissementGraphique[] = []
  const colonnes = new Map(jeu.colonnes.map(c => [c.cle, c]))
  const xCol = colonnes.get(spec.x)
  const chronoX = xCol?.type === 'periode' || xCol?.type === 'date'

  // --- mesures ---
  let ySpecs = spec.y
  if (FORMES_UNE_MESURE.includes(spec.forme) && ySpecs.length > 1) {
    avertissements.push({
      code: 'serie_ignoree',
      valeurs: { n: ySpecs.length - 1, forme: spec.forme },
    })
    ySpecs = ySpecs.slice(0, 1)
  } else if (spec.serie && spec.forme !== 'nuage' && ySpecs.length > 1) {
    avertissements.push({ code: 'serie_ignoree', valeurs: { n: ySpecs.length - 1, forme: spec.forme } })
    ySpecs = ySpecs.slice(0, 1)
  }
  const axePremiere = ySpecs[0]?.axe ?? 'gauche'
  const mesures: Mesure[] = ySpecs.map(y => {
    const colonne = colonnes.get(y.cle)
    const imposable = spec.forme !== 'combine' || (y.axe ?? 'gauche') === axePremiere
    const format: FormatColonne = (imposable ? spec.format : undefined) ?? colonne?.type ?? 'decimal'
    const axe = spec.forme === 'combine' ? (y.axe ?? 'gauche') : 'gauche'
    return {
      cle: y.cle,
      nom: y.libelle ?? colonne?.libelle ?? y.cle,
      colonne,
      format,
      additif: (colonne?.type ?? 'decimal') !== 'pourcentage',
      axe,
      forme: y.forme ?? (axe === 'droite' ? 'lignes' : 'barres'),
      formateur: colonne
        ? formateurColonne(colonne, locale, imposable ? spec.format : undefined)
        : creerFormateur(format, locale),
    }
  })

  const vide = (forme: FormeGraphique): ResultatOptionGraphique => {
    avertissements.push({ code: 'donnees_vides' })
    return {
      option: optionVide(contexte, traduire('graphique.aucuneDonnee')),
      formeEffective: forme,
      avertissements,
      vide: true,
    }
  }

  if (mesures.length === 0 || jeu.lignes.length === 0) return vide(spec.forme)

  // --- jauge : pas de catégories ---
  if (spec.forme === 'jauge') {
    const option = optionJauge(mesures[0], jeu, contexte, spec)
    if (!option) return vide('jauge')
    return { option, formeEffective: 'jauge', avertissements, vide: false }
  }

  // --- nuage : lignes une à une ---
  if (spec.forme === 'nuage') {
    const option = optionNuage(spec, jeu, contexte, colonnes, mesures[0])
    if (!option) return vide('nuage')
    return { option, formeEffective: 'nuage', avertissements, vide: false }
  }

  // --- catégories ---
  const libelleCat = creerLibelleCategorie(xCol, locale, traduire('graphique.sansValeur'))
  const index = new Map<string, Groupe>()
  for (const l of jeu.lignes) {
    const brut = l[spec.x]
    const cle = brut === null || brut === undefined ? '' : String(brut)
    let g = index.get(cle)
    if (!g) {
      g = { cle, libelle: libelleCat(cle), lignes: [] }
      index.set(cle, g)
    }
    g.lignes.push(l)
  }
  let cats = [...index.values()]
  const premiere = mesures[0]
  const triCol = spec.trierPar
  const mesureTri = triCol ? (mesures.find(m => m.cle === triCol) ?? null) : null
  const triParColonne = triCol && !mesureTri && triCol !== spec.x && colonnes.has(triCol) ? triCol : null
  const compare = (a: string, b: string) => a.localeCompare(b, locale, { numeric: true })
  const valTri = (g: Groupe): number | null => {
    if (mesureTri) return valeurGroupe(g, mesureTri)
    if (triParColonne) return agreger(nombres(g.lignes, triParColonne), true)
    return valeurGroupe(g, premiere)
  }
  const parLibelle = (a: Groupe, b: Groupe) => comparerLibelles(a.libelle, b.libelle, locale)
  const parValeur = (sens: 'asc' | 'desc') => (a: Groupe, b: Groupe) => {
    const va = valTri(a)
    const vb = valTri(b)
    if (va === null && vb === null) return parLibelle(a, b)
    if (va === null) return 1
    if (vb === null) return -1
    const ecart = sens === 'desc' ? vb - va : va - vb
    return ecart !== 0 ? ecart : parLibelle(a, b)
  }

  let chrono = false
  let sensChrono: 'asc' | 'desc' = 'asc'
  let triExplicite = true
  if (triCol === spec.x) {
    const sens = spec.sens ?? 'asc'
    cats.sort((a, b) => (sens === 'desc' ? compare(b.cle, a.cle) : compare(a.cle, b.cle)))
    chrono = chronoX
    sensChrono = sens
  } else if (mesureTri || triParColonne) {
    cats.sort(parValeur(spec.sens ?? 'desc'))
  } else if (chronoX) {
    sensChrono = spec.sens ?? 'asc'
    cats.sort((a, b) => (sensChrono === 'desc' ? compare(b.cle, a.cle) : compare(a.cle, b.cle)))
    chrono = true
  } else if (spec.sens || FORMES_CLASSEMENT.includes(spec.forme)) {
    cats.sort(parValeur(spec.sens ?? 'desc'))
  } else {
    // Ni tri demandé, ni classement, ni temps : libellés de A à Z.
    triExplicite = false
    cats.sort(parLibelle)
  }

  // --- limite : top N + Autres ---
  const limite = spec.limite
  if (limite && limite > 0 && cats.length > limite) {
    const total = cats.length
    let garde: Groupe[]
    let reste: Groupe[]
    if (chrono) {
      if (sensChrono === 'asc') {
        garde = cats.slice(total - limite)
        reste = cats.slice(0, total - limite)
      } else {
        garde = cats.slice(0, limite)
        reste = cats.slice(limite)
      }
    } else {
      if (!triExplicite) cats.sort(parValeur('desc'))
      garde = cats.slice(0, limite)
      reste = cats.slice(limite)
    }
    // Hors classement et sans tri demandé, les N gardés (choisis par valeur) reviennent de A à Z.
    if (!triExplicite) garde.sort(parLibelle)
    cats = garde
    if (!chrono && mesures.some(m => m.additif)) {
      cats.push({
        cle: CLE_AUTRES,
        libelle: traduire('graphique.autres'),
        lignes: reste.flatMap(g => g.lignes),
        autres: true,
      })
    }
    avertissements.push({ code: 'limite_appliquee', valeurs: { n: limite, total } })
  }

  // --- formes à une mesure ---
  let forme = spec.forme
  if (['secteurs', 'anneau', 'treemap', 'entonnoir'].includes(forme)) {
    const parts = cats
      .map(g => ({ g, v: valeurGroupe(g, premiere) }))
      .filter((p): p is { g: Groupe; v: number } => p.v !== null && p.v > 0)
    if (parts.length === 0) return vide(forme)
    if ((forme === 'secteurs' || forme === 'anneau') && parts.length > MAX_CATEGORIES_SECTEURS) {
      avertissements.push({
        code: 'forme_changee',
        valeurs: { de: forme, vers: 'barres_horizontales', n: parts.length },
      })
      forme = 'barres_horizontales'
    } else {
      const option = optionPartsDuTout(forme, parts, premiere, contexte)
      return { option, formeEffective: forme, avertissements, vide: false }
    }
  }

  if (forme === 'carte_chaleur') {
    const option = optionCarteChaleur(spec, cats, premiere, contexte)
    if (!option) return vide(forme)
    return { option, formeEffective: forme, avertissements, vide: false }
  }

  // --- cartésiennes ---
  const series = calculerSeries(spec, cats, mesures, traduire('graphique.sansValeur'), contexte.locale)
  if (series.every(s => s.valeurs.every(v => v === null))) return vide(forme)
  const option = optionCartesienne(forme, spec, cats, series, mesures, contexte)
  return { option, formeEffective: forme, avertissements, vide: false }
}

// ---------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------

function creerLibelleCategorie(
  col: ColonneJeu | undefined,
  locale: string,
  sansValeur: string
): (cle: string) => string {
  const f = col && (col.type === 'periode' || col.type === 'date') ? creerFormateur(col.type, locale) : null
  return cle => (cle === '' ? sansValeur : f ? f(cle) : cle)
}

function calculerSeries(
  spec: GraphiqueSpec,
  cats: Groupe[],
  mesures: Mesure[],
  sansValeur: string,
  locale: string
): SerieCalc[] {
  if (!spec.serie) {
    return mesures.map(m => ({ nom: m.nom, mesure: m, valeurs: cats.map(g => valeurGroupe(g, m)) }))
  }
  const m = mesures[0]
  const noms: string[] = []
  for (const g of cats)
    for (const l of g.lignes) {
      const v = l[spec.serie]
      const cle = v === null || v === undefined ? '' : String(v)
      if (!noms.includes(cle)) noms.push(cle)
    }
  // Ordre des séries stable et indépendant de l'ordre des catégories : A-Z, « sans valeur » en dernier.
  noms.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : comparerLibelles(a, b, locale)))
  return noms.map(cle => ({
    nom: cle === '' ? sansValeur : cle,
    mesure: m,
    valeurs: cats.map(g =>
      valeurGroupe(
        g,
        m,
        g.lignes.filter(l => {
          const v = l[spec.serie as string]
          return (v === null || v === undefined ? '' : String(v)) === cle
        })
      )
    ),
  }))
}

interface Base {
  option: Rec
  jt: ReturnType<typeof jetons>
  taille: number
}

function base(contexte: ContexteGraphique, accessible: { titre: string; description: string }, decal: boolean): Base {
  const jt = jetons(contexte.theme)
  const taille = contexte.compact ? 11 : 12
  const option: Rec = {
    backgroundColor: 'transparent',
    animation: !contexte.statique,
    textStyle: { fontFamily: FAMILLE_POLICE, fontSize: taille, color: jt.encre },
    aria: {
      enabled: true,
      label: { enabled: true, description: accessible.description },
      decal: { show: decal },
    },
    title: [{ text: accessible.titre, show: false }],
  }
  if (!contexte.statique) option.animationDuration = 300
  return { option, jt, taille }
}

function styleInfobulle(contexte: ContexteGraphique, jt: ReturnType<typeof jetons>): Rec {
  return {
    show: !contexte.statique,
    confine: true,
    backgroundColor: jt.infobulle.fond,
    borderColor: jt.infobulle.bordure,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: jt.infobulle.texte, fontFamily: FAMILLE_POLICE, fontSize: contexte.compact ? 11 : 12 },
    extraCssText: contexte.rtl
      ? 'direction: rtl; text-align: right; font-variant-numeric: tabular-nums;'
      : 'font-variant-numeric: tabular-nums;',
  }
}

function legende(
  contexte: ContexteGraphique,
  jt: ReturnType<typeof jetons>,
  noms: string[]
): Rec {
  const afficher = noms.length >= 2
  const bas = !!contexte.compact
  return {
    show: afficher,
    type: 'scroll',
    data: noms,
    top: bas ? undefined : 0,
    bottom: bas ? 0 : undefined,
    left: contexte.rtl ? 'right' : 'left',
    icon: 'roundRect',
    itemWidth: 12,
    itemHeight: 8,
    textStyle: { color: jt.encreAttenue, fontFamily: FAMILLE_POLICE, fontSize: contexte.compact ? 11 : 12 },
  }
}

function titreAccessible(
  forme: FormeGraphique,
  noms: string[],
  nbSeries: number,
  nbPoints: number,
  contexte: ContexteGraphique
) {
  return {
    titre: contexte.traduire('graphique.titreAccessible', {
      forme: contexte.traduire(`graphique.forme.${forme}`),
      mesures: noms.join(', '),
    }),
    description: contexte.traduire('graphique.descriptionAccessible', {
      series: nbSeries,
      points: nbPoints,
    }),
  }
}

function optionVide(contexte: ContexteGraphique, texte: string): OptionGraphique {
  const jt = jetons(contexte.theme)
  return {
    backgroundColor: 'transparent',
    animation: false,
    aria: { enabled: true },
    title: [
      {
        text: texte,
        left: 'center',
        top: 'middle',
        textStyle: { color: jt.encreAttenue, fontFamily: FAMILLE_POLICE, fontSize: 13, fontWeight: 'normal' },
      },
    ],
    series: [],
  }
}

// ---------------------------------------------------------------------------
// Cartésiennes
// ---------------------------------------------------------------------------

interface ParamsAxe {
  seriesIndex?: number
  seriesName?: string
  value?: unknown
  marker?: string
  axisValueLabel?: string
  name?: string
}

function infobulleAxe(series: SerieCalc[], total: { actif: boolean; nom: string }) {
  return (brut: unknown): string => {
    const liste = (Array.isArray(brut) ? brut : [brut]) as ParamsAxe[]
    if (liste.length === 0) return ''
    const titre = liste[0].axisValueLabel ?? liste[0].name ?? ''
    const lignes = liste
      .map(p => {
        const v = typeof p.value === 'number' ? p.value : enNombre(p.value)
        return { p, v, calc: series[p.seriesIndex ?? 0] }
      })
      .filter(x => x.v !== null && x.calc)
      .sort((a, b) => (b.v as number) - (a.v as number))
    const rangee = (gauche: string, droite: string, gras = false) =>
      `<div style="display:flex;justify-content:space-between;gap:16px;${gras ? 'font-weight:600;margin-top:4px;' : ''}"><span>${gauche}</span><span style="font-weight:600;font-variant-numeric:tabular-nums;">${echapperHtml(droite)}</span></div>`
    let html = `<div style="font-weight:600;margin-bottom:4px;">${echapperHtml(titre)}</div>`
    for (const { p, v, calc } of lignes)
      html += rangee(`${p.marker ?? ''}${echapperHtml(p.seriesName ?? calc.nom)}`, calc.mesure.formateur(v))
    if (total.actif && lignes.length > 1) {
      const somme = lignes.reduce((a, x) => a + (x.v as number), 0)
      html += rangee(echapperHtml(total.nom), lignes[0].calc.mesure.formateur(somme), true)
    }
    return html
  }
}

function optionCartesienne(
  forme: FormeGraphique,
  spec: GraphiqueSpec,
  cats: Groupe[],
  series: SerieCalc[],
  mesures: Mesure[],
  contexte: ContexteGraphique
): OptionGraphique {
  const horizontal = forme === 'barres_horizontales'
  const empile = forme === 'barres_empilees' || (spec.empile === true && forme !== 'lignes' && forme !== 'barres_horizontales')
  const nbSeries = series.length
  const noms = series.map(s => s.nom)
  const { option, jt, taille } = base(
    contexte,
    titreAccessible(forme, mesures.map(m => m.nom), nbSeries, cats.length * nbSeries, contexte),
    nbSeries > 1
  )
  option.color = couleursSeries(nbSeries, contexte.theme)
  const droite = forme === 'combine' && series.some(s => s.mesure.axe === 'droite')
  const additifs = series.every(s => s.mesure.additif)

  option.tooltip = {
    ...styleInfobulle(contexte, jt),
    trigger: 'axis',
    axisPointer: { type: forme.startsWith('barres') || forme === 'combine' ? 'shadow' : 'line' },
    formatter: infobulleAxe(series, {
      actif: empile && additifs,
      nom: contexte.traduire('graphique.total'),
    }),
  }
  option.legend = legende(contexte, jt, noms)

  const etiquettes = !empile && cats.length * nbSeries <= MAX_ETIQUETTES
  const zoom = !contexte.statique && !contexte.compact && cats.length > SEUIL_ZOOM
  const avecLegende = nbSeries >= 2
  // Barres horizontales : l'étiquette de valeur (« 227 504 € ») et la dernière graduation
  // dépassent de la barre ; on réserve la marge du côté où elles s'étendent (droite, ou
  // gauche en RTL où l'axe des valeurs est inversé).
  const margeValeurs = horizontal ? (etiquettes ? 84 : 32) : 16
  option.grid = {
    left: horizontal && contexte.rtl ? margeValeurs : 12,
    right: horizontal && contexte.rtl ? 16 : margeValeurs,
    top: avecLegende && !contexte.compact ? 44 : 16,
    bottom: (avecLegende && contexte.compact ? 40 : 8) + (zoom && !horizontal ? 32 : 0),
    containLabel: true,
  }

  const toutesEtiquettes = cats.length <= MAX_CATEGORIES_ETIQUETEES_AXE
  const axeCat: Rec = {
    type: 'category',
    data: cats.map(c => c.libelle),
    boundaryGap: forme.startsWith('barres') || forme === 'combine',
    inverse: horizontal ? true : contexte.rtl,
    position: horizontal && contexte.rtl ? 'right' : undefined,
    axisLine: { lineStyle: { color: jt.trait } },
    axisTick: { show: false },
    axisLabel: {
      color: jt.encreAttenue,
      fontSize: taille,
      // Jusqu'à 12 catégories, aucune n'est masquée : interval 0, retour à la ligne (axe
      // vertical) ou troncature (axe horizontal). Au-delà, ECharts masque les chevauchements.
      hideOverlap: !toutesEtiquettes,
      ...(toutesEtiquettes ? { interval: 0 } : {}),
      ...(horizontal
        ? { width: contexte.compact ? 80 : 120, overflow: 'truncate' }
        : toutesEtiquettes
          ? { width: contexte.compact ? 48 : 72, overflow: 'break', lineHeight: Math.round(taille * 1.25) }
          : {}),
    },
  }
  const axeVal = (m: Mesure, secondaire: boolean): Rec => ({
    type: 'value',
    position: horizontal ? 'bottom' : (contexte.rtl ? !secondaire : secondaire) ? 'right' : 'left',
    inverse: horizontal ? contexte.rtl : false,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: !secondaire, lineStyle: { color: jt.quadrillage } },
    axisLabel: {
      color: jt.encreAttenue,
      fontSize: taille,
      hideOverlap: true,
      formatter: creerFormateurAxe(m.format, contexte.locale),
    },
  })
  const mesureDroite = series.find(s => s.mesure.axe === 'droite')?.mesure
  const mesureGauche = series.find(s => s.mesure.axe === 'gauche')?.mesure ?? mesures[0]
  const axesVal: Rec[] = [axeVal(mesureGauche, false)]
  if (droite && mesureDroite) axesVal.push(axeVal(mesureDroite, true))

  if (horizontal) {
    option.yAxis = axeCat
    option.xAxis = axesVal[0]
  } else {
    option.xAxis = axeCat
    option.yAxis = axesVal.length === 1 ? axesVal[0] : axesVal
  }

  if (zoom) {
    option.dataZoom = [
      {
        type: 'slider',
        ...(horizontal ? { yAxisIndex: 0, width: 14 } : { xAxisIndex: 0, height: 16, bottom: 6 }),
        brushSelect: false,
        borderColor: jt.quadrillage,
        fillerColor: 'rgba(15, 76, 169, 0.12)',
        textStyle: { color: jt.encreAttenue, fontSize: taille },
      },
    ]
  }

  option.series = series.map(s => {
    const m = s.mesure
    const estLigne =
      forme === 'lignes' || forme === 'aires' || (forme === 'combine' && m.forme === 'lignes')
    const empileCeluiCi = estLigne ? forme === 'aires' && spec.empile === true : empile && (forme !== 'combine' || m.axe === 'gauche')
    const etiquette = etiquettes
      ? {
          show: true,
          position: horizontal ? (contexte.rtl ? 'left' : 'right') : 'top',
          color: jt.encre,
          fontSize: taille,
          formatter: (p: { value?: unknown }) => (p.value === null || p.value === undefined ? '' : m.formateur(p.value)),
        }
      : { show: false }
    const commun: Rec = {
      name: s.nom,
      data: s.valeurs,
      label: etiquette,
      ...(empileCeluiCi ? { stack: `pile-${m.axe}` } : {}),
      ...(droite ? { yAxisIndex: m.axe === 'droite' ? 1 : 0 } : {}),
    }
    if (estLigne) {
      return {
        ...commun,
        type: 'line',
        smooth: false,
        symbol: 'circle',
        symbolSize: 8,
        showSymbol: cats.length <= SEUIL_ZOOM,
        lineStyle: { width: 2 },
        itemStyle: { borderColor: jt.fond, borderWidth: 2 },
        ...(forme === 'aires' ? { areaStyle: { opacity: empileCeluiCi ? 0.5 : 0.18 } } : {}),
        label: etiquettes && nbSeries === 1 ? etiquette : { show: false },
      }
    }
    return {
      ...commun,
      type: 'bar',
      barMaxWidth: 40,
      itemStyle: empileCeluiCi
        ? { borderColor: jt.fond, borderWidth: 1 }
        : {
            borderRadius: horizontal
              ? contexte.rtl
                ? [4, 0, 0, 4]
                : [0, 4, 4, 0]
              : [4, 4, 0, 0],
          },
    }
  })
  return option
}

// ---------------------------------------------------------------------------
// Secteurs, anneau, treemap, entonnoir
// ---------------------------------------------------------------------------

function optionPartsDuTout(
  forme: FormeGraphique,
  parts: { g: Groupe; v: number }[],
  mesure: Mesure,
  contexte: ContexteGraphique
): OptionGraphique {
  const { traduire, locale } = contexte
  const { option, jt, taille } = base(
    contexte,
    titreAccessible(forme, [mesure.nom], 1, parts.length, contexte),
    parts.length > 1
  )
  const noms = parts.map(p => p.g.libelle)
  option.color = couleursSeries(parts.length, contexte.theme)
  const fPct = creerFormateur('pourcentage', locale)
  const data = parts.map(p => ({ name: p.g.libelle, value: p.v }))
  const total = parts.reduce((a, p) => a + p.v, 0)

  option.tooltip = {
    ...styleInfobulle(contexte, jt),
    trigger: 'item',
    formatter: (brut: unknown) => {
      const p = brut as { name?: string; value?: unknown; percent?: number; marker?: string }
      const v = typeof p.value === 'number' ? p.value : enNombre(p.value)
      const pct = forme === 'secteurs' || forme === 'anneau' ? ` (${fPct(p.percent ?? 0)})` : ''
      return `<div style="font-weight:600;margin-bottom:4px;">${echapperHtml(p.name)}</div><div>${p.marker ?? ''}${echapperHtml(mesure.nom)} <span style="font-weight:600;font-variant-numeric:tabular-nums;">${echapperHtml(mesure.formateur(v))}${echapperHtml(pct)}</span></div>`
    },
  }

  if (forme === 'secteurs' || forme === 'anneau') {
    option.legend = legende(contexte, jt, noms)
    const grille = !contexte.compact
    option.series = [
      {
        type: 'pie',
        radius: forme === 'anneau' ? ['45%', '70%'] : '70%',
        center: ['50%', contexte.compact ? '45%' : '55%'],
        data,
        startAngle: 90,
        avoidLabelOverlap: true,
        itemStyle: { borderColor: jt.fond, borderWidth: 2 },
        label: {
          show: grille,
          color: jt.encre,
          fontSize: taille,
          // Pourcentage seul : le nom est dans la légende, et « Mirambie · 24,… » se tronquait.
          formatter: (p: { percent?: number }) => fPct(p.percent ?? 0),
        },
        labelLine: { lineStyle: { color: jt.trait } },
      },
    ]
    if (forme === 'anneau') {
      ;(option.title as Rec[]).push({
        text: mesure.formateur(total),
        subtext: traduire('graphique.total'),
        left: 'center',
        top: contexte.compact ? '37%' : '47%',
        textStyle: { color: jt.encre, fontFamily: FAMILLE_POLICE, fontSize: contexte.compact ? 13 : 16, fontWeight: 600 },
        subtextStyle: { color: jt.encreAttenue, fontFamily: FAMILLE_POLICE, fontSize: taille },
      })
    }
    return option
  }

  option.legend = { show: false }
  const etiquette = {
    show: true,
    color: jt.surSerie,
    fontSize: taille,
    formatter: (p: { name?: string; value?: unknown }) =>
      `${p.name ?? ''}\n${mesure.formateur(p.value)}`,
  }
  if (forme === 'treemap') {
    option.series = [
      {
        type: 'treemap',
        data,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        left: 0,
        top: 0,
        label: { ...etiquette, position: 'insideTopLeft', overflow: 'truncate' },
        itemStyle: { borderColor: jt.fond, borderWidth: 2, gapWidth: 2 },
        color: couleursSeries(parts.length, contexte.theme),
        colorMappingBy: 'index',
        levels: [{ itemStyle: { borderColor: jt.fond, borderWidth: 0, gapWidth: 2 } }],
      },
    ]
    return option
  }
  option.series = [
    {
      type: 'funnel',
      data,
      sort: 'descending',
      gap: 2,
      left: '8%',
      width: '84%',
      top: 8,
      bottom: 8,
      minSize: '8%',
      itemStyle: { borderColor: jt.fond, borderWidth: 1 },
      label: { ...etiquette, position: 'inside' },
    },
  ]
  return option
}

// ---------------------------------------------------------------------------
// Carte de chaleur
// ---------------------------------------------------------------------------

function optionCarteChaleur(
  spec: GraphiqueSpec,
  cats: Groupe[],
  mesure: Mesure,
  contexte: ContexteGraphique
): OptionGraphique | null {
  const sansValeur = contexte.traduire('graphique.sansValeur')
  const ordonnees: string[] = []
  const cleOrd = (l: Ligne) => {
    if (!spec.serie) return ''
    const v = l[spec.serie]
    return v === null || v === undefined ? '' : String(v)
  }
  for (const g of cats)
    for (const l of g.lignes) {
      const c = cleOrd(l)
      if (!ordonnees.includes(c)) ordonnees.push(c)
    }
  const cellules: { x: number; y: number; v: number }[] = []
  cats.forEach((g, xi) => {
    ordonnees.forEach((c, yi) => {
      const v = valeurGroupe(g, mesure, g.lignes.filter(l => cleOrd(l) === c))
      if (v !== null) cellules.push({ x: xi, y: yi, v })
    })
  })
  if (cellules.length === 0) return null
  const { option, jt, taille } = base(
    contexte,
    titreAccessible('carte_chaleur', [mesure.nom], ordonnees.length, cellules.length, contexte),
    false
  )
  const min = Math.min(...cellules.map(c => c.v))
  const max = Math.max(...cellules.map(c => c.v))
  const etiquetees = cellules.length <= MAX_CELLULES_ETIQUETEES
  const nomsY = ordonnees.map(c => (spec.serie ? (c === '' ? sansValeur : c) : mesure.nom))
  option.tooltip = {
    ...styleInfobulle(contexte, jt),
    trigger: 'item',
    formatter: (brut: unknown) => {
      const p = brut as { value?: unknown[] }
      const [xi, yi, v] = (p.value ?? []) as number[]
      return `<div style="font-weight:600;margin-bottom:4px;">${echapperHtml(cats[xi]?.libelle)} · ${echapperHtml(nomsY[yi])}</div><div><span style="font-weight:600;font-variant-numeric:tabular-nums;">${echapperHtml(mesure.formateur(v))}</span></div>`
    },
  }
  option.grid = { left: 12, right: 16, top: 12, bottom: 56, containLabel: true }
  option.xAxis = {
    type: 'category',
    data: cats.map(c => c.libelle),
    inverse: contexte.rtl,
    splitArea: { show: false },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: jt.trait } },
    axisLabel: { color: jt.encreAttenue, fontSize: taille, hideOverlap: true },
  }
  option.yAxis = {
    type: 'category',
    data: nomsY,
    inverse: true,
    position: contexte.rtl ? 'right' : 'left',
    axisTick: { show: false },
    axisLine: { show: false },
    axisLabel: { color: jt.encreAttenue, fontSize: taille, hideOverlap: true, width: 110, overflow: 'truncate' },
  }
  option.visualMap = {
    type: 'continuous',
    min,
    max: max === min ? min + 1 : max,
    dimension: 2,
    calculable: false,
    orient: 'horizontal',
    left: 'center',
    bottom: 0,
    itemWidth: 12,
    itemHeight: contexte.compact ? 90 : 160,
    inRange: { color: [...jt.rampe] },
    textStyle: { color: jt.encreAttenue, fontSize: taille },
    formatter: (v: unknown) => mesure.formateur(v),
  }
  option.series = [
    {
      type: 'heatmap',
      name: mesure.nom,
      data: cellules.map(c => ({
        value: [c.x, c.y, c.v],
        label: {
          color: (c.v - min) / (max - min || 1) > 0.5 ? jt.surSerie : jt.encre,
        },
      })),
      itemStyle: { borderColor: jt.fond, borderWidth: 2 },
      label: {
        show: etiquetees,
        fontSize: taille,
        formatter: (p: { value?: unknown[] }) => mesure.formateur(p.value?.[2]),
      },
    },
  ]
  return option
}

// ---------------------------------------------------------------------------
// Nuage de points
// ---------------------------------------------------------------------------

function optionNuage(
  spec: GraphiqueSpec,
  jeu: JeuClient,
  contexte: ContexteGraphique,
  colonnes: Map<string, ColonneJeu>,
  mesureY: Mesure
): OptionGraphique | null {
  const colX = colonnes.get(spec.x)
  const formatX: FormatColonne = colX?.type ?? 'decimal'
  const fX = colX ? formateurColonne(colX, contexte.locale) : creerFormateur(formatX, contexte.locale)
  const groupes = new Map<string, [number, number][]>()
  const sansValeur = contexte.traduire('graphique.sansValeur')
  let total = 0
  for (const l of jeu.lignes) {
    const x = enNombre(l[spec.x])
    const y = enNombre(l[mesureY.cle])
    if (x === null || y === null) continue
    const sv = spec.serie ? l[spec.serie] : null
    const nom = spec.serie ? (sv === null || sv === undefined || sv === '' ? sansValeur : String(sv)) : mesureY.nom
    const liste = groupes.get(nom) ?? []
    liste.push([x, y])
    groupes.set(nom, liste)
    total++
  }
  if (total === 0) return null
  const noms = [...groupes.keys()]
  const { option, jt, taille } = base(
    contexte,
    titreAccessible('nuage', [mesureY.nom], noms.length, total, contexte),
    noms.length > 1
  )
  option.color = couleursSeries(noms.length, contexte.theme)
  option.tooltip = {
    ...styleInfobulle(contexte, jt),
    trigger: 'item',
    formatter: (brut: unknown) => {
      const p = brut as { seriesName?: string; value?: number[]; marker?: string }
      const [x, y] = p.value ?? []
      return `<div style="font-weight:600;margin-bottom:4px;">${p.marker ?? ''}${echapperHtml(p.seriesName)}</div><div>${echapperHtml(colX?.libelle ?? spec.x)} <span style="font-weight:600;font-variant-numeric:tabular-nums;">${echapperHtml(fX(x))}</span></div><div>${echapperHtml(mesureY.nom)} <span style="font-weight:600;font-variant-numeric:tabular-nums;">${echapperHtml(mesureY.formateur(y))}</span></div>`
    },
  }
  option.legend = legende(contexte, jt, noms)
  option.grid = {
    left: 12,
    right: 16,
    top: noms.length >= 2 && !contexte.compact ? 44 : 16,
    bottom: noms.length >= 2 && contexte.compact ? 56 : 28,
    containLabel: true,
  }
  const axe = (nom: string, f: FormatColonne, y: boolean): Rec => ({
    type: 'value',
    name: nom,
    nameLocation: 'middle',
    nameGap: y ? 48 : 28,
    nameTextStyle: { color: jt.encreAttenue, fontSize: taille },
    scale: true,
    inverse: !y && contexte.rtl,
    position: y ? (contexte.rtl ? 'right' : 'left') : 'bottom',
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: jt.quadrillage } },
    axisLabel: { color: jt.encreAttenue, fontSize: taille, hideOverlap: true, formatter: creerFormateurAxe(f, contexte.locale) },
  })
  option.xAxis = axe(colX?.libelle ?? spec.x, formatX, false)
  option.yAxis = axe(mesureY.nom, mesureY.format, true)
  option.series = noms.map(nom => ({
    type: 'scatter',
    name: nom,
    data: groupes.get(nom),
    symbolSize: 8,
    itemStyle: { borderColor: jt.fond, borderWidth: 1 },
  }))
  return option
}

// ---------------------------------------------------------------------------
// Jauge
// ---------------------------------------------------------------------------

function optionJauge(
  mesure: Mesure,
  jeu: JeuClient,
  contexte: ContexteGraphique,
  spec: GraphiqueSpec
): OptionGraphique | null {
  void spec
  // Même règle que les cartes d'indicateurs : total du jeu, sinon l'unique ligne, jamais la première
  // ligne d'un jeu de plusieurs lignes.
  const valeur = enNombre(valeurSansLigne(jeu, mesure.cle))
  if (valeur === null) return null
  const pct = mesure.colonne?.type === 'pourcentage' || mesure.format === 'pourcentage'
  const max = pct ? 100 : valeur > 0 ? valeur * 1.25 : 1
  const { option, jt, taille } = base(
    contexte,
    titreAccessible('jauge', [mesure.nom], 1, 1, contexte),
    false
  )
  const couleurValeur = pct ? couleurEtatTaux(valeur, contexte.theme) : jt.cobalt
  option.tooltip = {
    ...styleInfobulle(contexte, jt),
    trigger: 'item',
    formatter: () =>
      `<div style="font-weight:600;">${echapperHtml(mesure.nom)}</div><div style="font-variant-numeric:tabular-nums;">${echapperHtml(mesure.formateur(valeur))}</div>`,
  }
  const zones: [number, string][] = pct
    ? [
        [SEUIL_TAUX_ALERTE / 100, jt.etat.aRisque],
        [SEUIL_TAUX_ATTEINT / 100, jt.etat.enCours],
        [1, jt.etat.atteint],
      ]
    : [[1, jt.quadrillage]]
  option.series = [
    {
      type: 'gauge',
      min: 0,
      max,
      startAngle: 200,
      endAngle: -20,
      radius: contexte.compact ? '90%' : '85%',
      progress: { show: false },
      axisLine: { lineStyle: { width: 14, color: zones } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: jt.encreAttenue,
        fontSize: taille,
        distance: 18,
        formatter: creerFormateurAxe(pct ? 'pourcentage' : mesure.format, contexte.locale),
      },
      pointer: { width: 5, length: '60%', itemStyle: { color: couleurValeur } },
      anchor: { show: true, size: 10, itemStyle: { color: couleurValeur } },
      title: {
        color: jt.encreAttenue,
        fontSize: taille,
        offsetCenter: [0, '78%'],
      },
      detail: {
        valueAnimation: !contexte.statique,
        offsetCenter: [0, '58%'],
        fontSize: contexte.compact ? 18 : 24,
        fontWeight: 600,
        fontFamily: FAMILLE_POLICE,
        color: jt.encre,
        formatter: (v: unknown) => mesure.formateur(v),
      },
      data: [
        {
          value: valeur,
          name: pct
            ? `${mesure.nom} · ${contexte.traduire('graphique.objectif')} ${creerFormateur('pourcentage', contexte.locale, { decimales: 0 })(100)}`
            : mesure.nom,
        },
      ],
    },
  ]
  return option
}
