/**
 * Export PowerPoint (pptxgenjs 4) d'un artefact préparé, aux couleurs des exports Excel.
 *
 * Diapositives (format 16:9, masque « DATAGENIUS » : bandeau bleu nuit, numéro de page, pied
 * « Data Genius · Exporté le … ») :
 * - titre : titre, sous-titre, lignes de contexte, date d'export ;
 * - graphique : graphique NATIF, modifiable dans PowerPoint (barres, barres empilées,
 *   barres horizontales, lignes, aires, secteurs, anneau, nuage, combiné à deux axes), aux
 *   couleurs de la charte, formats de nombre natifs (`#,##0 "€"`, `0.0" %"`), légende ;
 *   treemap, entonnoir, carte de chaleur et jauge n'existent pas dans PowerPoint : image SVG
 *   rendue par ECharts, NON modifiable (une note le dit sur la diapositive) ; puis une
 *   diapositive de ses données en tableau s'il a au plus 25 lignes ;
 * - tableau : `addTable` paginé automatiquement (`autoPage`), en-tête répété ; plafonné à
 *   200 lignes (note : l'Excel contient tout), découpé au-delà de 12 colonnes ;
 * - indicateurs : cartes (libellé, valeur, comparaison, objectif, statut écrit à côté de sa
 *   couleur), 6 par diapositive ;
 * - texte : une diapositive par section du markdown (titres de niveau 1 et 2), listes à
 *   puces, « (suite) » si le texte déborde ;
 * - dernière : « Sources et calcul », une provenance par jeu (le SQL n'est jamais lu).
 *
 * Langue : texte de chrome par `prep.traduire` ; arabe : `rtlMode` sur la présentation et
 * sur chaque texte, positions du masque inversées. Les nombres des graphiques restent des
 * nombres (formats natifs), affichés selon les paramètres régionaux de PowerPoint.
 */

import type PptxGenJSType from 'pptxgenjs';

import { toIntlTag } from '@/i18n/config';

import type { FormatColonne, GraphiqueSpec } from '@/lib/medic-assist/contrats';
import { creerFormateur, estFormatNumerique } from '../formats';
import { construireOptionGraphique } from '../graphique-option';
import { couleursSeries } from '../palette';
import type {
  ContexteGraphique,
  IndicateurResolu,
  ModeleTableau,
  OptionGraphique,
  ResultatOptionGraphique,
  Traducteur,
} from '../types-rendu';
import {
  analyserMarkdown,
  decouperEnSections,
  texteDeSegments,
  type BlocListe,
  type BlocMarkdown,
  type Segment,
} from './markdown-blocs';
import { CHARTE, couleurEntete, decouperColonnes, largeursProportionnelles } from './polices';
import { rendreGraphiqueSvg } from './svg-serveur';
import type { BlocExport, ExportPrepare } from './types';

type Pptx = PptxGenJSType;
type Diapo = PptxGenJSType.Slide;
type Ligne = PptxGenJSType.TableRow;
type Texte = PptxGenJSType.TextProps;
type OptionsGraphique = PptxGenJSType.IChartOpts;
type DonneesGraphique = PptxGenJSType.OptsChartData;
type NomGraphique = PptxGenJSType.CHART_NAME;

/** Au-delà, le tableau de la présentation est tronqué (l'Excel contient toutes les lignes). */
export const LIGNES_MAX_PPTX = 200;
/** Au-delà, le tableau est découpé en parties (colonnes de dimension répétées). */
export const COLONNES_MAX_DIAPO = 12;
/** Un graphique a sa diapositive de données s'il a au plus ce nombre de lignes. */
export const LIGNES_MAX_DONNEES_GRAPHIQUE = 25;
/** Étiquettes de valeur affichées jusqu'à ce nombre de points. */
const POINTS_MAX_ETIQUETTES = 12;
const INDICATEURS_PAR_DIAPO = 6;
const PROVENANCES_PAR_DIAPO = 3;
/** Points d'un nuage gardés au plus (au-delà, PowerPoint devient lent). */
const POINTS_MAX_NUAGE = 2000;
/** Lignes de texte estimées par diapositive (corps en 14 pt). */
const LIGNES_TEXTE_PAR_DIAPO = 15;
const CARACTERES_PAR_LIGNE = 105;

const MASQUE = 'DATAGENIUS';
const POLICE = 'Calibri';
// Dimensions en pouces (LAYOUT_WIDE : 13,33 × 7,5).
const L = 13.333;
const H = 7.5;
const MARGE_X = 0.4;
const LARGEUR_UTILE = L - 2 * MARGE_X;
const HAUT_BANDEAU = 0.55;
const Y_TITRE = 0.68;
const Y_CONTENU = 1.3;
const Y_PIED = 7.08;
const BAS_CONTENU = 6.9;
/** Haut des diapositives de suite d'un tableau paginé (sous le bandeau). */
const Y_SUITE_TABLEAU = 0.8;

/** Formes natives de PowerPoint ; les autres sont insérées en image. */
const FORMES_IMAGE = new Set(['treemap', 'entonnoir', 'carte_chaleur', 'jauge']);

interface Contexte {
  prep: ExportPrepare;
  pptx: Pptx;
  t: Traducteur;
  rtl: boolean;
  lang: string;
}

// ---------------------------------------------------------------------------
// Chargement (serveur seulement)
// ---------------------------------------------------------------------------

type ConstructeurPptx = new () => Pptx;

async function chargerPptxGen(): Promise<ConstructeurPptx> {
  // Chargé à la demande (paquet externe de Next, jamais dans le paquet client).
  const mod = (await import('pptxgenjs')) as unknown as { default?: unknown };
  const candidat = (mod.default ?? mod) as unknown;
  const constructeur = (
    typeof candidat === 'function' ? candidat : (candidat as { default?: unknown }).default
  ) as ConstructeurPptx | undefined;
  if (typeof constructeur !== 'function') throw new Error('pptxgenjs : constructeur introuvable');
  return constructeur;
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

// Caractères interdits en XML 1.0 : ils rendraient le fichier illisible pour PowerPoint.
// eslint-disable-next-line no-control-regex
const RE_INTERDIT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

/** Texte sûr pour le XML de la présentation. */
export function texteSur(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  return String(valeur).replace(RE_INTERDIT_XML, '').replace(/\r\n?/g, '\n');
}

const sansDiese = (couleur: string) => couleur.replace(/^#/, '').toUpperCase();

/** Code de format de nombre natif (Office) d'un format de colonne. */
export function codeFormatNatif(format: FormatColonne | undefined): string {
  switch (format) {
    case 'montant':
    case 'montant_compact':
      return '#,##0 "€"';
    case 'pourcentage':
      return '0.0" %"';
    case 'entier':
      return '#,##0';
    case 'decimal':
      return '#,##0.00';
    default:
      return 'General';
  }
}

function formaterDateHeure(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      date
    );
  } catch {
    return date.toISOString();
  }
}

function variationFormatee(points: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      signDisplay: 'exceptZero',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(points / 100);
  } catch {
    return `${points.toFixed(1)} %`;
  }
}

function enNombreOuNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function optionsTexte(ctx: Contexte, extra: PptxGenJSType.TextPropsOptions = {}) {
  return {
    fontFace: POLICE,
    color: CHARTE.encre,
    align: ctx.rtl ? ('right' as const) : ('left' as const),
    ...(ctx.rtl ? { rtlMode: true } : {}),
    lang: ctx.lang,
    ...extra,
  };
}

function nouvelleDiapo(ctx: Contexte, titre?: string): Diapo {
  const diapo = ctx.pptx.addSlide({ masterName: MASQUE });
  if (titre && titre.trim() !== '') {
    diapo.addText(
      texteSur(titre),
      optionsTexte(ctx, {
        x: MARGE_X,
        y: Y_TITRE,
        w: LARGEUR_UTILE,
        h: 0.55,
        fontSize: 22,
        bold: true,
        color: CHARTE.bleuNuit,
        valign: 'middle',
        fit: 'shrink',
      })
    );
  }
  return diapo;
}

function note(ctx: Contexte, diapo: Diapo, texte: string, y: number, h = 0.32) {
  diapo.addText(
    texteSur(texte),
    optionsTexte(ctx, {
      x: MARGE_X,
      y,
      w: LARGEUR_UTILE,
      h,
      fontSize: 11,
      italic: true,
      color: CHARTE.grisTexte,
      valign: 'top',
    })
  );
}

// ---------------------------------------------------------------------------
// Masque et diapositive de titre
// ---------------------------------------------------------------------------

function definirMasque(ctx: Contexte) {
  const { prep, t, rtl } = ctx;
  const exporteLe = t('exports.exporteLe', { date: formaterDateHeure(prep.exporteLe, ctx.lang) });
  const pied = prep.exportePar ? `${exporteLe} · ${texteSur(prep.exportePar)}` : exporteLe;
  const marque = t('exportsPptx.marque');
  const lMarque = 3;
  const lPied = L - 2 * MARGE_X - 1.2;
  ctx.pptx.defineSlideMaster({
    title: MASQUE,
    background: { color: CHARTE.blanc },
    margin: [Y_SUITE_TABLEAU, MARGE_X, H - BAS_CONTENU, MARGE_X],
    slideNumber: {
      x: rtl ? MARGE_X : L - MARGE_X - 1,
      y: Y_PIED,
      w: 1,
      h: 0.3,
      fontFace: POLICE,
      fontSize: 9,
      color: CHARTE.grisTexte,
      align: rtl ? 'left' : 'right',
    },
    objects: [
      { rect: { x: 0, y: 0, w: L, h: HAUT_BANDEAU, fill: { color: CHARTE.bleuNuit } } },
      {
        text: {
          text: marque,
          options: {
            x: rtl ? L - MARGE_X - lMarque : MARGE_X,
            y: 0,
            w: lMarque,
            h: HAUT_BANDEAU,
            fontFace: POLICE,
            fontSize: 14,
            bold: true,
            color: CHARTE.blanc,
            valign: 'middle',
            align: rtl ? 'right' : 'left',
            ...(rtl ? { rtlMode: true } : {}),
          },
        },
      },
      {
        line: {
          x: MARGE_X,
          y: Y_PIED - 0.05,
          w: LARGEUR_UTILE,
          h: 0,
          line: { color: CHARTE.grisBordure, width: 0.75 },
        },
      },
      {
        text: {
          text: `${marque} · ${pied}`,
          options: {
            x: rtl ? L - MARGE_X - lPied : MARGE_X,
            y: Y_PIED,
            w: lPied,
            h: 0.3,
            fontFace: POLICE,
            fontSize: 9,
            color: CHARTE.grisTexte,
            valign: 'middle',
            align: rtl ? 'right' : 'left',
            ...(rtl ? { rtlMode: true } : {}),
          },
        },
      },
    ],
  });
}

function diapoTitre(ctx: Contexte) {
  const { prep, t } = ctx;
  const diapo = ctx.pptx.addSlide({ masterName: MASQUE });
  diapo.addText(
    texteSur(prep.titre),
    optionsTexte(ctx, {
      x: MARGE_X + 0.3,
      y: 2.1,
      w: LARGEUR_UTILE - 0.6,
      h: 1.2,
      fontSize: 34,
      bold: true,
      color: CHARTE.bleuNuit,
      valign: 'bottom',
      fit: 'shrink',
    })
  );
  let y = 3.4;
  if (prep.sousTitre && prep.sousTitre.trim() !== '') {
    diapo.addText(
      texteSur(prep.sousTitre),
      optionsTexte(ctx, {
        x: MARGE_X + 0.3,
        y,
        w: LARGEUR_UTILE - 0.6,
        h: 0.6,
        fontSize: 18,
        color: CHARTE.grisTexte,
        valign: 'top',
        fit: 'shrink',
      })
    );
    y += 0.7;
  }
  const lignes = [
    ...prep.lignesContexte.map(texteSur),
    t('exports.exporteLe', { date: formaterDateHeure(prep.exporteLe, ctx.lang) }),
  ];
  diapo.addText(
    lignes.map((texte, i) => ({
      text: texte,
      options: { breakLine: i < lignes.length - 1 },
    })),
    optionsTexte(ctx, {
      x: MARGE_X + 0.3,
      y,
      w: LARGEUR_UTILE - 0.6,
      h: Math.max(0.4, 0.32 * lignes.length),
      fontSize: 13,
      color: CHARTE.grisTexte,
      valign: 'top',
    })
  );
}

// ---------------------------------------------------------------------------
// Tableaux
// ---------------------------------------------------------------------------

function taillePolice(nbColonnes: number): number {
  if (nbColonnes <= 6) return 11;
  if (nbColonnes <= 9) return 10;
  return 9;
}

function alignement(c: ModeleTableau['colonnes'][number], rtl: boolean) {
  if (c.format === 'date') return 'center' as const;
  const fin = c.alignement === 'end' || estFormatNumerique(c.format);
  // En RTL, « début » est à droite.
  if (fin) return rtl ? ('left' as const) : ('right' as const);
  return rtl ? ('right' as const) : ('left' as const);
}

/**
 * Ajoute le(s) tableau(x) d'un modèle sur de nouvelles diapositives titrées `titre`
 * (une par partie de colonnes ; la pagination des lignes est faite par pptxgenjs).
 */
function diaposTableau(ctx: Contexte, titre: string, modele: ModeleTableau, sousTitre?: string) {
  const { t, prep, rtl } = ctx;
  const colonnes = modele.colonnes;
  if (colonnes.length === 0) return;
  const formateurs = colonnes.map(c => creerFormateur(c.format, prep.locale, { unite: c.unite }));
  const tronque = modele.lignes.length > LIGNES_MAX_PPTX;
  const lignes = tronque ? modele.lignes.slice(0, LIGNES_MAX_PPTX) : modele.lignes;
  let indexLibelleTotal = colonnes.findIndex(c => c.type === 'dimension');
  if (indexLibelleTotal < 0) indexLibelleTotal = 0;

  const corps = lignes.map(l => colonnes.map((c, k) => texteSur(formateurs[k](l[c.id]))));
  const totaux = modele.totaux
    ? colonnes.map((c, k) =>
        k === indexLibelleTotal
          ? t('exports.total')
          : texteSur(formateurs[k]((modele.totaux as Record<string, unknown>)[c.id]))
      )
    : null;
  const entetes = colonnes.map(c => texteSur(c.libelle));
  const parties = decouperColonnes(colonnes, COLONNES_MAX_DIAPO);

  parties.forEach(partie => {
    // En RTL, la première colonne est à droite : ordre inversé.
    const idx = rtl ? [...partie.indices].reverse() : partie.indices;
    const taille = taillePolice(idx.length);
    const diapo = nouvelleDiapo(ctx, titre);
    let y = Y_CONTENU;
    const notes: string[] = [];
    if (sousTitre && sousTitre.trim() !== '') notes.push(texteSur(sousTitre));
    if (parties.length > 1) {
      notes.push(
        t('exportsPptx.partieColonnes', {
          debut: partie.premiere,
          fin: partie.derniere,
          total: partie.total,
        })
      );
    }
    if (tronque) {
      notes.push(t('exportsPptx.troncature', { n: LIGNES_MAX_PPTX, total: modele.lignes.length }));
    }
    if (notes.length > 0) {
      note(ctx, diapo, notes.join('\n'), y - 0.05, 0.3 * notes.length);
      y += 0.3 * notes.length;
    }

    const longueurs = idx.map(k => {
      let l = Math.min(entetes[k].length, 18);
      for (const ligne of corps.slice(0, 200)) l = Math.max(l, ligne[k].length);
      if (totaux) l = Math.max(l, totaux[k].length);
      return l;
    });
    const largeurs = largeursProportionnelles(longueurs, LARGEUR_UTILE, { min: 5, max: 40 });
    const bordure = { type: 'solid' as const, pt: 0.5, color: CHARTE.grisBordure };
    const alignements = idx.map(k => alignement(colonnes[k], rtl));

    const rangees: Ligne[] = [
      idx.map(k => ({
        text: entetes[k],
        options: {
          bold: true,
          color: CHARTE.blanc,
          fill: { color: couleurEntete(colonnes[k].format) },
          align: 'center' as const,
          valign: 'middle' as const,
        },
      })),
    ];
    corps.forEach((ligne, r) => {
      rangees.push(
        idx.map((k, j) => ({
          text: ligne[k],
          options: {
            align: alignements[j],
            ...(r % 2 === 1 ? { fill: { color: CHARTE.bande } } : {}),
          },
        }))
      );
    });
    if (totaux) {
      rangees.push(
        idx.map((k, j) => ({
          text: totaux[k],
          options: {
            bold: true,
            align:
              k === indexLibelleTotal
                ? rtl
                  ? ('right' as const)
                  : ('left' as const)
                : alignements[j],
            fill: { color: CHARTE.fondTotal },
            border: [
              { type: 'solid' as const, pt: 1, color: CHARTE.bleuNuit },
              bordure,
              bordure,
              bordure,
            ],
          },
        }))
      );
    }

    diapo.addTable(rangees, {
      x: MARGE_X,
      y,
      w: LARGEUR_UTILE,
      colW: largeurs,
      fontFace: POLICE,
      fontSize: taille,
      color: CHARTE.encre,
      border: bordure,
      valign: 'middle',
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageHeaderRows: 1,
      autoPageSlideStartY: Y_SUITE_TABLEAU,
      ...(rtl ? { rtlMode: true } : {}),
    } as PptxGenJSType.TableProps);
  });
}

// ---------------------------------------------------------------------------
// Graphiques natifs
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

interface SerieExtraite {
  nom: string;
  valeurs: (number | null)[];
  type: 'bar' | 'line';
  empilee: boolean;
  droite: boolean;
  couleur: string;
}

/** Catégories et séries de l'option ECharts cartésienne (mêmes données qu'à l'écran). */
export function extraireCartesien(option: OptionGraphique): {
  categories: string[];
  series: SerieExtraite[];
} {
  const horizontal = (option.yAxis as Rec | undefined)?.type === 'category';
  const axeCat = (horizontal ? option.yAxis : option.xAxis) as Rec | undefined;
  const categories = ((axeCat?.data as unknown[]) ?? []).map(c => texteSur(c));
  const couleurs = ((option.color as string[]) ?? []).map(sansDiese);
  const series = ((option.series as Rec[]) ?? []).map((s, i) => ({
    nom: texteSur(s.name),
    valeurs: ((s.data as unknown[]) ?? []).map(enNombreOuNull),
    type: s.type === 'line' ? ('line' as const) : ('bar' as const),
    empilee: typeof s.stack === 'string',
    droite: s.yAxisIndex === 1,
    couleur: couleurs[i % Math.max(1, couleurs.length)] ?? CHARTE.bleuQuantite,
  }));
  return { categories, series };
}

function formatsDesMesures(bloc: Extract<BlocExport, { type: 'graphique' }>) {
  const spec: GraphiqueSpec = bloc.spec;
  const colonnes = new Map(bloc.jeu.colonnes.map(c => [c.cle, c]));
  const premiere = spec.y[0];
  const axePremiere = premiere?.axe ?? 'gauche';
  const formatDe = (cle: string | undefined, imposable: boolean): FormatColonne =>
    (imposable ? spec.format : undefined) ??
    (cle ? colonnes.get(cle)?.type : undefined) ??
    'decimal';
  const gauche = spec.y.find(y => (y.axe ?? 'gauche') === 'gauche') ?? premiere;
  const droite = spec.y.find(y => y.axe === 'droite');
  return {
    gauche: formatDe(
      gauche?.cle,
      spec.forme !== 'combine' || (gauche?.axe ?? 'gauche') === axePremiere
    ),
    droite: formatDe(
      droite?.cle,
      spec.forme !== 'combine' || (droite?.axe ?? 'gauche') === axePremiere
    ),
  };
}

function optionsCommunes(lang: string, nbPoints: number, nbSeries: number): OptionsGraphique {
  return {
    x: MARGE_X,
    y: Y_CONTENU,
    w: LARGEUR_UTILE,
    h: BAS_CONTENU - Y_CONTENU - 0.35,
    lang,
    showLegend: nbSeries > 1,
    legendPos: 'b',
    legendFontFace: POLICE,
    legendFontSize: 11,
    legendColor: CHARTE.grisTexte,
    catAxisLabelFontFace: POLICE,
    catAxisLabelFontSize: 11,
    catAxisLabelColor: CHARTE.grisTexte,
    catAxisLineColor: CHARTE.grisBordure,
    valAxisLabelFontFace: POLICE,
    valAxisLabelFontSize: 11,
    valAxisLabelColor: CHARTE.grisTexte,
    valAxisLineShow: false,
    valGridLine: { color: CHARTE.grisBordure, size: 0.75, style: 'solid' },
    catGridLine: { style: 'none' },
    dataLabelFontFace: POLICE,
    dataLabelFontSize: 10,
    dataLabelColor: CHARTE.encre,
    showValue: nbPoints <= POINTS_MAX_ETIQUETTES,
    showTitle: false,
  };
}

interface GraphiqueNatif {
  type: NomGraphique | PptxGenJSType.IChartMulti[];
  donnees: DonneesGraphique[];
  options: OptionsGraphique;
}

/** Graphique natif équivalent à l'option ECharts, ou `null` si la forme n'existe pas. */
export function graphiqueNatif(
  ctx: Pick<Contexte, 'rtl' | 'lang'>,
  bloc: Extract<BlocExport, { type: 'graphique' }>,
  resultat: ResultatOptionGraphique
): GraphiqueNatif | null {
  const forme = resultat.formeEffective;
  if (FORMES_IMAGE.has(forme)) return null;
  const option = resultat.option;
  const formats = formatsDesMesures(bloc);
  const codeGauche = codeFormatNatif(formats.gauche);
  const codeDroite = codeFormatNatif(formats.droite);

  if (forme === 'secteurs' || forme === 'anneau') {
    const serie = ((option.series as Rec[]) ?? [])[0];
    const parts = ((serie?.data as { name?: unknown; value?: unknown }[]) ?? []).filter(
      p => enNombreOuNull(p.value) !== null
    );
    const couleurs = couleursSeries(parts.length, 'clair').map(sansDiese);
    return {
      type: forme === 'anneau' ? 'doughnut' : 'pie',
      donnees: [
        {
          name: texteSur(serie?.name ?? ''),
          labels: parts.map(p => texteSur(p.name)),
          values: parts.map(p => p.value as number),
        },
      ],
      options: {
        ...optionsCommunes(ctx.lang, parts.length, 2),
        showLegend: true,
        legendPos: ctx.rtl ? 'l' : 'r',
        chartColors: couleurs,
        showValue: false,
        showPercent: true,
        showLeaderLines: true,
        dataLabelPosition: 'bestFit',
        dataLabelFormatCode: codeGauche,
        holeSize: forme === 'anneau' ? 55 : undefined,
        firstSliceAng: 0,
        dataBorder: { pt: 1, color: CHARTE.blanc },
      },
    };
  }

  if (forme === 'nuage') {
    const series = ((option.series as Rec[]) ?? []).map(s => ({
      nom: texteSur(s.name),
      points: ((s.data as unknown[]) ?? []) as [number, number][],
    }));
    // Abscisses communes : chaque série a ses ordonnées à ses propres positions, vide ailleurs.
    const x: number[] = [];
    const y: (number | null)[][] = series.map(() => []);
    let reste = POINTS_MAX_NUAGE;
    series.forEach((s, i) => {
      for (const [px, py] of s.points.slice(0, Math.max(0, reste))) {
        x.push(px);
        series.forEach((_, j) => y[j].push(j === i ? py : null));
      }
      reste -= s.points.length;
    });
    const formatX: FormatColonne =
      bloc.jeu.colonnes.find(c => c.cle === bloc.spec.x)?.type ?? 'decimal';
    return {
      type: 'scatter',
      donnees: [
        { name: 'X', values: x },
        ...series.map((s, i) => ({ name: s.nom, values: y[i] as number[] })),
      ],
      options: {
        ...optionsCommunes(ctx.lang, Number.POSITIVE_INFINITY, series.length),
        chartColors: couleursSeries(series.length, 'clair').map(sansDiese),
        lineSize: 0,
        lineDataSymbol: 'circle',
        lineDataSymbolSize: 7,
        valAxisLabelFormatCode: codeGauche,
        catAxisLabelFormatCode: codeFormatNatif(formatX),
        showValAxisTitle: true,
        valAxisTitle: texteSur((option.yAxis as Rec | undefined)?.name ?? ''),
        valAxisTitleFontSize: 11,
        valAxisTitleColor: CHARTE.grisTexte,
        showCatAxisTitle: true,
        catAxisTitle: texteSur((option.xAxis as Rec | undefined)?.name ?? ''),
        catAxisTitleFontSize: 11,
        catAxisTitleColor: CHARTE.grisTexte,
      } as OptionsGraphique,
    };
  }

  // Cartésiens : barres, barres empilées, barres horizontales, lignes, aires, combiné.
  const { categories: cats, series: brutes } = extraireCartesien(option);
  const horizontal = forme === 'barres_horizontales';
  // ECharts dessine les barres horizontales de haut en bas, PowerPoint de bas en haut ; en
  // RTL, les catégories d'un graphique vertical vont de droite à gauche : ordre inversé.
  const inverser = horizontal || ctx.rtl;
  const ordonner = <T>(liste: T[]): T[] => (inverser ? [...liste].reverse() : liste);
  const categories = ordonner(cats);
  const series = brutes.map(s => ({ ...s, valeurs: ordonner(s.valeurs) }));
  const nbPoints = categories.length * series.length;
  const communes = optionsCommunes(ctx.lang, nbPoints, series.length);
  const donnees = (liste: SerieExtraite[]): DonneesGraphique[] =>
    liste.map(s => ({ name: s.nom, labels: categories, values: s.valeurs as number[] }));

  if (forme === 'combine') {
    const aDroite = series.some(s => s.droite) && series.some(s => !s.droite);
    const groupes: { type: 'bar' | 'line'; droite: boolean }[] = [
      { type: 'bar', droite: false },
      { type: 'line', droite: false },
      { type: 'bar', droite: true },
      { type: 'line', droite: true },
    ];
    const types: PptxGenJSType.IChartMulti[] = [];
    for (const g of groupes) {
      const membres = series.filter(
        s => s.type === g.type && (aDroite ? s.droite : false) === g.droite
      );
      if (membres.length === 0) continue;
      const empilee = g.type === 'bar' && membres.some(s => s.empilee);
      types.push({
        type: g.type,
        data: donnees(membres),
        options: {
          chartColors: membres.map(s => s.couleur),
          ...(g.type === 'bar'
            ? { barDir: 'col', barGrouping: empilee ? 'stacked' : 'clustered', barGapWidthPct: 60 }
            : { lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 7 }),
          ...(empilee ? { barOverlapPct: 100 } : {}),
          ...(g.droite ? { secondaryValAxis: true, secondaryCatAxis: true } : {}),
        },
      });
    }
    return {
      type: types,
      donnees: [],
      options: {
        ...communes,
        showLegend: true,
        showValue: false,
        ...(aDroite
          ? {
              valAxes: [
                { valAxisLabelFormatCode: codeGauche },
                { valAxisLabelFormatCode: codeDroite, valGridLine: { style: 'none' } },
              ],
              catAxes: [{}, { catAxisHidden: true }],
            }
          : { valAxisLabelFormatCode: codeGauche }),
      },
    };
  }

  const empilee = series.some(s => s.empilee);
  const options: OptionsGraphique = {
    ...communes,
    chartColors: series.map(s => s.couleur),
    valAxisLabelFormatCode: codeGauche,
    dataLabelFormatCode: codeGauche,
  };
  if (forme === 'lignes') {
    return {
      type: 'line',
      donnees: donnees(series),
      options: {
        ...options,
        lineSize: 2,
        lineDataSymbol: 'circle',
        lineDataSymbolSize: 7,
        dataLabelPosition: 't',
      },
    };
  }
  if (forme === 'aires') {
    return {
      type: 'area',
      donnees: donnees(series),
      options: {
        ...options,
        barGrouping: empilee ? 'stacked' : 'standard',
        chartColorsOpacity: empilee ? 85 : 55,
        showValue: false,
      },
    };
  }
  return {
    type: 'bar',
    donnees: donnees(series),
    options: {
      ...options,
      barDir: horizontal ? 'bar' : 'col',
      barGrouping: empilee || forme === 'barres_empilees' ? 'stacked' : 'clustered',
      ...(empilee || forme === 'barres_empilees' ? { barOverlapPct: 100, showValue: false } : {}),
      barGapWidthPct: 60,
      dataLabelPosition: empilee || forme === 'barres_empilees' ? 'ctr' : 'outEnd',
    },
  };
}

async function diaposGraphique(ctx: Contexte, bloc: Extract<BlocExport, { type: 'graphique' }>) {
  const { t, prep } = ctx;
  const titre = bloc.titre.trim() !== '' ? bloc.titre : t('exportsPptx.titresParDefaut.graphique');
  const contexteGraphique: ContexteGraphique = {
    locale: prep.locale,
    theme: 'clair',
    rtl: prep.rtl,
    traduire: prep.traduire,
    compact: false,
    statique: true,
  };
  const diapo = nouvelleDiapo(ctx, titre);
  const notes: string[] = [];
  if (bloc.sousTitre && bloc.sousTitre.trim() !== '') notes.push(texteSur(bloc.sousTitre));
  try {
    const resultat = construireOptionGraphique(bloc.spec, bloc.jeu, contexteGraphique);
    for (const a of resultat.avertissements) {
      if (a.code === 'limite_appliquee' && a.valeurs) {
        notes.push(
          t('exportsPptx.limiteAppliquee', { n: a.valeurs.n ?? '', total: a.valeurs.total ?? '' })
        );
      }
    }
    if (resultat.vide) {
      notes.push(texteSur(prep.traduire('graphique.aucuneDonnee')));
      note(ctx, diapo, notes.join('\n'), Y_CONTENU, 0.35 * notes.length);
      return;
    }
    const natif = graphiqueNatif(ctx, bloc, resultat);
    if (natif && Array.isArray(natif.type)) {
      // Graphique combiné : pptxgenjs lit les options globales dans le DEUXIÈME argument
      // (`tmpOpt = data || opt`), contrairement à ce que dit sa déclaration de types ; un
      // tableau vide à cette place deviendrait les options (et `[].fill` une couleur).
      diapo.addChart(natif.type, natif.options as unknown as unknown[]);
    } else if (natif) {
      diapo.addChart(natif.type, natif.donnees, natif.options);
    } else {
      notes.push(t('exportsPptx.imageNonModifiable'));
      const largeurPx = 1200;
      const hauteurPx = Math.round((largeurPx * (BAS_CONTENU - Y_CONTENU - 0.35)) / LARGEUR_UTILE);
      const svg = await rendreGraphiqueSvg(resultat.option, {
        largeur: largeurPx,
        hauteur: hauteurPx,
      });
      diapo.addImage({
        data: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
        x: MARGE_X,
        y: Y_CONTENU,
        w: LARGEUR_UTILE,
        h: BAS_CONTENU - Y_CONTENU - 0.35,
        altText: texteSur(titre),
      });
    }
    if (notes.length > 0) note(ctx, diapo, notes.join('  ·  '), BAS_CONTENU - 0.32);
  } catch {
    // Graphique impossible à construire : la diapositive le dit, les données suivent.
    notes.push(t('exportsPptx.graphiqueIndisponible'));
    note(ctx, diapo, notes.join('\n'), Y_CONTENU, 0.35 * notes.length);
    diaposTableau(
      ctx,
      t('exportsPptx.donneesDuGraphique', { titre: texteSur(titre) }),
      bloc.modele
    );
    return;
  }
  if (bloc.modele.lignes.length > 0 && bloc.modele.lignes.length <= LIGNES_MAX_DONNEES_GRAPHIQUE) {
    diaposTableau(
      ctx,
      t('exportsPptx.donneesDuGraphique', { titre: texteSur(titre) }),
      bloc.modele
    );
  }
}

// ---------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------

const CLE_STATUT = { atteint: 'atteint', en_cours: 'enCours', a_risque: 'aRisque' } as const;
const COULEUR_STATUT = {
  atteint: CHARTE.etat.atteint,
  en_cours: CHARTE.etat.enCours,
  a_risque: CHARTE.etat.aRisque,
} as const;

function textesCarte(ctx: Contexte, ind: IndicateurResolu): Texte[] {
  const { t, lang } = ctx;
  const nd = t('exportsPptx.indicateurs.nonDisponible');
  const ligne = (text: string, options: PptxGenJSType.TextPropsOptions): Texte => ({
    text,
    options: { breakLine: true, ...options },
  });
  const runs: Texte[] = [
    ligne(texteSur(ind.libelle), { bold: true, fontSize: 12, color: CHARTE.grisTexte }),
    ligne(ind.valeur === null ? nd : texteSur(ind.valeurFormatee), {
      bold: true,
      fontSize: 26,
      color: CHARTE.encre,
      paraSpaceAfter: 4,
    }),
  ];
  const detail = { fontSize: 11, color: CHARTE.grisTexte };
  if (ind.comparaison) {
    const c = ind.comparaison;
    runs.push(
      ligne(
        t('exportsPptx.libelleValeur', {
          libelle: texteSur(c.libelle),
          valeur: c.valeur === null ? nd : texteSur(c.valeurFormatee),
        }),
        detail
      )
    );
    if (c.variationPct !== null) {
      const valeur = variationFormatee(c.variationPct, lang);
      runs.push(
        ligne(
          c.sens
            ? t('exportsPptx.indicateurs.variationSens', {
                valeur,
                sens: t(`exportsPptx.indicateurs.sens.${c.sens}`),
              })
            : t('exportsPptx.indicateurs.variation', { valeur }),
          detail
        )
      );
    }
  }
  if (ind.objectif) {
    const o = ind.objectif;
    runs.push(
      ligne(
        t('exportsPptx.libelleValeur', {
          libelle: texteSur(o.libelle ?? '') || t('exports.indicateurs.objectif'),
          valeur: o.valeur === null ? nd : texteSur(o.valeurFormatee),
        }),
        detail
      )
    );
    if (o.taux !== null) {
      runs.push(
        ligne(
          t('exportsPptx.indicateurs.realisation', {
            valeur: creerFormateur('pourcentage', ctx.prep.locale)(o.taux),
          }),
          detail
        )
      );
    }
    if (o.statut) {
      const couleur = COULEUR_STATUT[o.statut];
      // Le statut est écrit, la couleur ne fait que l'accompagner.
      runs.push({ text: '■ ', options: { color: couleur, fontSize: 13 } });
      runs.push({
        text: t(`exports.indicateurs.statuts.${CLE_STATUT[o.statut]}`),
        options: { color: couleur, bold: true, fontSize: 12 },
      });
    }
  }
  return runs;
}

function diaposIndicateurs(ctx: Contexte, bloc: Extract<BlocExport, { type: 'indicateurs' }>) {
  const { t } = ctx;
  const titre =
    bloc.titre.trim() !== '' ? bloc.titre : t('exportsPptx.titresParDefaut.indicateurs');
  const parLigne = 3;
  const ecart = 0.25;
  const largeur = (LARGEUR_UTILE - ecart * (parLigne - 1)) / parLigne;
  const hauteur = 2.6;
  const liste = bloc.indicateurs.length > 0 ? bloc.indicateurs : [];
  for (let i = 0; i < Math.max(1, liste.length); i += INDICATEURS_PAR_DIAPO) {
    const diapo = nouvelleDiapo(
      ctx,
      i === 0 ? titre : t('exportsPptx.suite', { titre: texteSur(titre) })
    );
    let y0 = Y_CONTENU;
    if (i === 0 && bloc.sousTitre && bloc.sousTitre.trim() !== '') {
      note(ctx, diapo, bloc.sousTitre, Y_CONTENU - 0.05);
      y0 += 0.3;
    }
    liste.slice(i, i + INDICATEURS_PAR_DIAPO).forEach((ind, k) => {
      const col = k % parLigne;
      const rang = Math.floor(k / parLigne);
      const colAffichee = ctx.rtl ? parLigne - 1 - col : col;
      diapo.addText(
        textesCarte(ctx, ind),
        optionsTexte(ctx, {
          x: MARGE_X + colAffichee * (largeur + ecart),
          y: y0 + rang * (hauteur + ecart),
          w: largeur,
          h: hauteur,
          valign: 'top',
          fill: { color: CHARTE.blanc },
          line: { color: CHARTE.grisBordure, width: 1 },
          margin: 10,
          fit: 'shrink',
        })
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Texte (markdown)
// ---------------------------------------------------------------------------

interface Paragraphe {
  runs: Texte[];
  lignes: number;
}

function runsDeSegments(segments: Segment[], base: PptxGenJSType.TextPropsOptions): Texte[] {
  return segments
    .filter(s => s.texte !== '')
    .map(s => ({
      text: texteSur(s.texte),
      options: {
        ...base,
        ...(s.gras ? { bold: true } : {}),
        ...(s.italique ? { italic: true } : {}),
        ...(s.code ? { fontFace: 'Consolas', color: CHARTE.grisTexte } : {}),
      },
    }));
}

function lignesEstimees(segments: Segment[], niveau = 0): number {
  const n = Array.from(texteDeSegments(segments)).length + niveau * 4;
  return Math.max(1, Math.ceil(n / CARACTERES_PAR_LIGNE));
}

/** Termine le paragraphe : le dernier morceau porte le saut de ligne. */
function fermer(runs: Texte[], options: PptxGenJSType.TextPropsOptions = {}): Texte[] {
  if (runs.length === 0) return [{ text: ' ', options: { ...options, breakLine: true } }];
  const dernier = runs[runs.length - 1];
  runs[runs.length - 1] = {
    ...dernier,
    options: { ...dernier.options, ...options, breakLine: true },
  };
  return runs;
}

function paragraphesDeListe(liste: BlocListe, niveau: number, rtl: boolean): Paragraphe[] {
  const sortie: Paragraphe[] = [];
  liste.elements.forEach((e, i) => {
    const puce: PptxGenJSType.TextPropsOptions['bullet'] = liste.ordonnee
      ? { type: 'number', numberStartAt: liste.debut + i, indent: 18 }
      : { indent: 18 };
    const runs = runsDeSegments(e.segments, {});
    // La puce et le retrait sont des propriétés de paragraphe : sur le premier morceau.
    const tete = runs.length > 0 ? runs : [{ text: ' ', options: {} }];
    tete[0] = {
      ...tete[0],
      options: {
        ...tete[0].options,
        bullet: puce,
        indentLevel: niveau,
        ...(rtl ? { rtlMode: true } : {}),
      },
    };
    sortie.push({
      runs: fermer(tete, { paraSpaceAfter: 3 }),
      lignes: lignesEstimees(e.segments, niveau + 1),
    });
    for (const sous of e.sousListes) sortie.push(...paragraphesDeListe(sous, niveau + 1, rtl));
  });
  return sortie;
}

function diaposTexte(ctx: Contexte, markdown: string) {
  const { t } = ctx;
  const sections = decouperEnSections(analyserMarkdown(markdown));
  for (const section of sections) {
    const titre = section.titre
      ? texteDeSegments(section.titre)
      : t('exportsPptx.titresParDefaut.texte');
    const paragraphes: Paragraphe[] = [];
    const tableaux: Extract<BlocMarkdown, { type: 'tableau' }>[] = [];
    for (const b of section.blocs) {
      if (b.type === 'paragraphe') {
        paragraphes.push({
          runs: fermer(runsDeSegments(b.segments, {}), { paraSpaceAfter: 8 }),
          lignes: lignesEstimees(b.segments) + 0.4,
        });
      } else if (b.type === 'titre') {
        paragraphes.push({
          runs: fermer(
            runsDeSegments(b.segments, { bold: true, color: CHARTE.bleuNuit, fontSize: 16 }),
            {
              paraSpaceBefore: 6,
              paraSpaceAfter: 4,
            }
          ),
          lignes: lignesEstimees(b.segments) + 0.6,
        });
      } else if (b.type === 'liste') {
        paragraphes.push(...paragraphesDeListe(b, 0, ctx.rtl));
      } else {
        tableaux.push(b);
      }
    }

    // Découpe en diapositives selon le nombre de lignes estimé.
    const paquets: Paragraphe[][] = [];
    let courant: Paragraphe[] = [];
    let lignes = 0;
    for (const p of paragraphes) {
      if (courant.length > 0 && lignes + p.lignes > LIGNES_TEXTE_PAR_DIAPO) {
        paquets.push(courant);
        courant = [];
        lignes = 0;
      }
      courant.push(p);
      lignes += p.lignes;
    }
    if (courant.length > 0) paquets.push(courant);
    if (paquets.length === 0 && tableaux.length === 0) paquets.push([]);

    paquets.forEach((paquet, i) => {
      const diapo = nouvelleDiapo(ctx, i === 0 ? titre : t('exportsPptx.suite', { titre }));
      if (paquet.length === 0) return;
      diapo.addText(
        paquet.flatMap(p => p.runs),
        optionsTexte(ctx, {
          x: MARGE_X,
          y: Y_CONTENU,
          w: LARGEUR_UTILE,
          h: BAS_CONTENU - Y_CONTENU,
          fontSize: 14,
          valign: 'top',
          fit: 'shrink',
        })
      );
    });

    for (const tableau of tableaux) {
      const align = (k: number) => {
        const a = tableau.alignements[k];
        if (a === 'center') return 'center' as const;
        if (a === 'end') return ctx.rtl ? ('left' as const) : ('right' as const);
        return ctx.rtl ? ('right' as const) : ('left' as const);
      };
      const ordre = (cellules: Segment[][]) => (ctx.rtl ? [...cellules].reverse() : cellules);
      const n = tableau.entetes.length;
      const ki = (k: number) => (ctx.rtl ? n - 1 - k : k);
      const rangees: Ligne[] = [
        ordre(tableau.entetes).map((e, k) => ({
          text: texteSur(texteDeSegments(e)),
          options: {
            bold: true,
            color: CHARTE.blanc,
            fill: { color: CHARTE.bleuNuit },
            align: align(ki(k)),
          },
        })),
        ...tableau.lignes.map((l, r) =>
          ordre(l).map((c, k) => ({
            text: texteSur(texteDeSegments(c)),
            options: {
              align: align(ki(k)),
              ...(r % 2 === 1 ? { fill: { color: CHARTE.bande } } : {}),
            },
          }))
        ),
      ];
      const diapo = nouvelleDiapo(
        ctx,
        paquets.length > 0 ? t('exportsPptx.suite', { titre }) : titre
      );
      diapo.addTable(rangees, {
        x: MARGE_X,
        y: Y_CONTENU,
        w: LARGEUR_UTILE,
        fontFace: POLICE,
        fontSize: 12,
        color: CHARTE.encre,
        border: { type: 'solid', pt: 0.5, color: CHARTE.grisBordure },
        autoPage: true,
        autoPageRepeatHeader: true,
        autoPageHeaderRows: 1,
        autoPageSlideStartY: Y_SUITE_TABLEAU,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Sources et calcul
// ---------------------------------------------------------------------------

function diaposSources(ctx: Contexte) {
  const { t, prep } = ctx;
  const titre = t('exportsPptx.sourcesEtCalcul');
  const aucun = t('exports.provenance.aucun');
  const provenances = prep.provenances;
  if (provenances.length === 0) {
    const diapo = nouvelleDiapo(ctx, titre);
    note(ctx, diapo, aucun, Y_CONTENU);
    return;
  }
  for (let i = 0; i < provenances.length; i += PROVENANCES_PAR_DIAPO) {
    const diapo = nouvelleDiapo(ctx, i === 0 ? titre : t('exportsPptx.suite', { titre }));
    let y = Y_CONTENU;
    if (i === 0 && prep.exportePar) {
      note(
        ctx,
        diapo,
        t('exports.provenance.exportePar', { nom: texteSur(prep.exportePar) }),
        y - 0.05
      );
      y += 0.3;
    }
    const hauteurBloc = (BAS_CONTENU - y) / PROVENANCES_PAR_DIAPO;
    // Champs nommés un à un : `Provenance.sql` n'est jamais lu.
    provenances.slice(i, i + PROVENANCES_PAR_DIAPO).forEach((p, k) => {
      const calcule = new Date(p.calculeA);
      const lignes: [string, string][] = [
        [t('exports.provenance.periode'), p.periode?.libelle || aucun],
        [t('exports.provenance.perimetre'), p.perimetre?.libelle || aucun],
        [
          t('exports.provenance.filtres'),
          p.filtres.length > 0
            ? p.filtres
                .map(f => t('exportsPptx.libelleValeur', { libelle: f.libelle, valeur: f.valeur }))
                .join(' ; ')
            : aucun,
        ],
        [t('exports.provenance.regles'), p.regles.length > 0 ? p.regles.join(' ; ') : aucun],
        [
          t('exports.provenance.calculeLe'),
          Number.isNaN(calcule.getTime()) ? aucun : formaterDateHeure(calcule, ctx.lang),
        ],
        [
          t('exports.provenance.lienEcran'),
          p.lienEcran ? `${p.lienEcran.libelle} (${p.lienEcran.href})` : aucun,
        ],
      ];
      const yBloc = y + k * hauteurBloc;
      diapo.addText(
        texteSur(p.libelleSource),
        optionsTexte(ctx, {
          x: MARGE_X,
          y: yBloc,
          w: LARGEUR_UTILE,
          h: 0.3,
          fontSize: 13,
          bold: true,
          color: CHARTE.bleuNuit,
        })
      );
      const rangees: Ligne[] = lignes.map(([libelle, valeur]) => {
        const cellules = [
          { text: texteSur(libelle), options: { bold: true, color: CHARTE.grisTexte } },
          { text: texteSur(valeur), options: {} },
        ];
        return ctx.rtl ? cellules.reverse() : cellules;
      });
      diapo.addTable(rangees, {
        x: MARGE_X,
        y: yBloc + 0.32,
        w: LARGEUR_UTILE,
        colW: ctx.rtl ? [LARGEUR_UTILE - 2.6, 2.6] : [2.6, LARGEUR_UTILE - 2.6],
        fontFace: POLICE,
        fontSize: 9,
        color: CHARTE.encre,
        align: ctx.rtl ? 'right' : 'left',
        border: { type: 'solid', pt: 0.5, color: CHARTE.grisBordure },
        rowH: 0.24,
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Présentation
// ---------------------------------------------------------------------------

async function diaposDuBloc(ctx: Contexte, bloc: BlocExport) {
  switch (bloc.type) {
    case 'texte':
      diaposTexte(ctx, bloc.markdown);
      return;
    case 'tableau':
      diaposTableau(
        ctx,
        bloc.titre.trim() !== '' ? bloc.titre : ctx.t('exportsPptx.titresParDefaut.tableau'),
        bloc.modele,
        bloc.sousTitre
      );
      return;
    case 'graphique':
      await diaposGraphique(ctx, bloc);
      return;
    case 'indicateurs':
      diaposIndicateurs(ctx, bloc);
      return;
  }
}

/** Construit la présentation. Le Buffer est une archive ZIP (commence par `PK`). */
export async function construirePptx(prep: ExportPrepare): Promise<Buffer> {
  const PptxGenJS = await chargerPptxGen();
  const pptx = new PptxGenJS();
  const lang = toIntlTag(prep.locale);
  const t: Traducteur = (cle, valeurs) => texteSur(prep.traduire(cle, valeurs));
  const ctx: Contexte = { prep, pptx, t, rtl: prep.rtl, lang };

  pptx.layout = 'LAYOUT_WIDE';
  pptx.rtlMode = prep.rtl;
  pptx.title = texteSur(prep.titre);
  pptx.author = 'Data Genius';
  pptx.company = 'Data Genius';
  pptx.subject = texteSur(prep.sousTitre ?? '');
  pptx.revision = '1';
  pptx.theme = { headFontFace: POLICE, bodyFontFace: POLICE };

  definirMasque(ctx);
  diapoTitre(ctx);
  for (const bloc of prep.blocs) await diaposDuBloc(ctx, bloc);
  diaposSources(ctx);

  const sortie = await pptx.stream({ compression: true });
  if (Buffer.isBuffer(sortie)) return sortie;
  if (sortie instanceof Uint8Array)
    return Buffer.from(sortie.buffer, sortie.byteOffset, sortie.byteLength);
  if (sortie instanceof ArrayBuffer) return Buffer.from(sortie);
  throw new Error('pptxgenjs : sortie inattendue');
}

