/**
 * Export Excel (.xlsx) d'un artefact préparé, avec la charte `lib/excel/mise-en-forme.ts`.
 *
 * - une feuille par tableau, graphique (ses données) et bloc d'indicateurs ; les blocs de
 *   texte d'un document n'ont pas de feuille ;
 * - valeurs BRUTES : nombres (jamais des chaînes formatées), pourcentages en points,
 *   dates en vrais objets Date ; le format d'affichage passe par l'option `colonnes` du
 *   helper, indexée par libellé d'en-tête ;
 * - une feuille « Provenance » (une ligne par provenance distincte) : source, période,
 *   périmètre, filtres, règles, date de calcul, écran source en texte. Jamais de SQL ;
 * - noms d'onglets de 31 caractères au plus, coupés sur une limite de mot ;
 * - classeur finalisé par `classeurEnBuffer` (compatible Excel 2007) ;
 * - cellules texte : Excel les lit comme du texte (type chaîne), un « =… » n'y est jamais
 *   une formule ; la neutralisation n'est donc nécessaire que pour le csv.
 */

import { PassThrough, Readable } from 'node:stream';

import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import {
  classeurEnBuffer,
  construireFeuille,
  nomFeuilleValide,
  type FormatColonne as FormatExcel,
  type LibellesExport,
  type OptionsColonne,
} from '@/lib/excel/mise-en-forme';
import { toIntlTag } from '@/i18n/config';
import { compatibiliserExcel2007 } from '@/lib/utils/compatibilite-excel';

import type { FormatColonne } from '@/lib/medic-assist/contrats';
import { estDecimalExact } from '@/lib/medic-assist/contrats/numerique';
import { creerFormateur, enNombre, estFormatNumerique } from '../formats';
import type { IndicateurResolu, ModeleTableau } from '../types-rendu';
import { tableauIndicateurs } from './tableau-indicateurs';
import type { ExportPrepare } from './types';

const LONGUEUR_FEUILLE = 31;

/** Format de colonne Medic Assist vers format du helper Excel. */
export function formatExcel(format: FormatColonne | undefined): FormatExcel {
  switch (format) {
    case 'entier':
      return 'entier';
    case 'decimal':
      return 'decimal';
    case 'montant':
    case 'montant_compact':
      return 'montant';
    case 'pourcentage':
      return 'pourcentage';
    case 'date':
      return 'date';
    default:
      // periode (libellé formaté par `valeurBrute`) et texte : texte.
      return 'texte';
  }
}

/** `YYYY-MM-DD` (ou ISO) vers une date à minuit LOCAL (le helper la reporte en UTC), ou null. */
function enDate(valeur: unknown): Date | null {
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur;
  if (typeof valeur !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valeur);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Valeur de cellule brute selon le format de la colonne. Avec `locale`, une période
 * (`YYYY-MM`) est écrite comme à l'écran (« avr. 2026 ») ; sans, elle reste telle quelle.
 */
export function valeurBrute(
  valeur: unknown,
  format: FormatColonne | undefined,
  locale?: string
): unknown {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  if (format === 'periode' && locale) return creerFormateur('periode', locale)(valeur);
  if (estFormatNumerique(format)) {
    if (estDecimalExact(valeur)) return valeur;
    const n = enNombre(valeur);
    return n === null ? String(valeur) : n;
  }
  if (format === 'date') return enDate(valeur) ?? String(valeur);
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return valeur;
  if (valeur instanceof Date) return valeur;
  return String(valeur);
}

/** Libellés uniques : les doublons reçoivent « (2) », « (3) »… ; un libellé vide devient son rang. */
export function entetesUniques(libelles: string[]): string[] {
  const vus = new Set<string>();
  return libelles.map((brut, i) => {
    const base = brut.trim() === '' ? String(i + 1) : brut;
    let nom = base;
    let n = 2;
    while (vus.has(nom)) nom = `${base} (${n++})`;
    vus.add(nom);
    return nom;
  });
}

/**
 * Coupe à `max` unités au plus, sur une limite de MOT quand une espace existe avant la
 * limite. Sans espace (chinois, arabe collé), coupe net, jamais au milieu d'une paire de
 * substitution. Le résultat n'a ni espace ni apostrophe en fin.
 */
export function couperSurMot(texte: string, max: number): string {
  const propre = texte.trim();
  if (propre.length <= max) return propre;
  let coupe = propre.slice(0, max);
  if (!/\s/.test(propre.charAt(max))) {
    const dernier = coupe.search(/\s\S*$/);
    if (dernier > 0) coupe = coupe.slice(0, dernier);
    else if (/[\uD800-\uDBFF]$/.test(coupe)) coupe = coupe.slice(0, -1);
  }
  return coupe.replace(/[\s'’]+$/, '');
}

/** Un nom de feuille unique (comparaison sans casse, 31 caractères au plus, coupé sur un mot). */
export function nomFeuilleUnique(base: string, pris: Set<string>): string {
  // Nettoyage sans troncature (la coupe se fait ici, sur un mot), puis contrôle du helper.
  const nettoye = String(base ?? '')
    .replace(/[[\]:*?/\\]/g, '')
    .replace(/'/g, '’');
  const propre = nomFeuilleValide(couperSurMot(nettoye, LONGUEUR_FEUILLE));
  let nom = propre;
  let n = 2;
  while (pris.has(nom.toLowerCase())) {
    const suffixe = ` (${n++})`;
    nom = `${couperSurMot(propre, LONGUEUR_FEUILLE - suffixe.length)}${suffixe}`;
  }
  pris.add(nom.toLowerCase());
  return nom;
}

interface ColonneFeuille {
  libelle: string;
  format: FormatColonne;
}

interface DescriptionFeuille {
  nom: string;
  titre: string;
  sousTitres: string[];
  colonnes: ColonneFeuille[];
  /** Valeurs déjà converties, dans l'ordre des colonnes. */
  lignes: unknown[][];
  /** Colorer les colonnes de taux selon les seuils de réalisation. */
  seuils?: Set<string>;
  estLigneTotal?: (cellules: unknown[]) => boolean;
}

const ENTIER_INDEX = /^(0|[1-9]\d*)$/;

function ajouterFeuille(
  classeur: ExcelJS.Workbook,
  prep: ExportPrepare,
  libelles: Partial<LibellesExport>,
  d: DescriptionFeuille
): ExcelJS.Worksheet {
  const entetes = entetesUniques(d.colonnes.map(c => c.libelle));
  // Une clé d'objet qui ressemble à un entier est triée avant les autres : la colonne « 2026 »
  // passerait en tête. On donne alors une clé neutre au helper et on remet le vrai libellé
  // dans l'en-tête ensuite.
  const cles = entetes.map((e, i) => (ENTIER_INDEX.test(e) ? `__c${i}` : e));
  const colonnesOptions: Record<string, OptionsColonne> = {};
  d.colonnes.forEach((c, i) => {
    colonnesOptions[cles[i]] = {
      format: formatExcel(c.format),
      ...(d.seuils?.has(entetes[i]) ? { seuils: true } : { seuils: false }),
    };
  });

  const lignes: Record<string, unknown>[] =
    d.lignes.length > 0
      ? d.lignes.map(valeurs => Object.fromEntries(cles.map((cle, i) => [cle, valeurs[i] ?? null])))
      : [Object.fromEntries(cles.map(cle => [cle, null]))];

  const feuille = construireFeuille(classeur, d.nom, lignes, {
    titre: d.titre,
    sousTitre: d.sousTitres,
    colonnes: colonnesOptions,
    libelles,
    estLigneTotal: d.estLigneTotal ?? (() => false),
    dateExport: prep.exporteLe,
  });

  const ligneEntete = d.sousTitres.filter(s => s.trim() !== '').length + 4;
  const rangeeEntete = feuille.getRow(ligneEntete);
  entetes.forEach((e, i) => {
    if (cles[i] !== e) rangeeEntete.getCell(i + 1).value = e;
  });
  if (prep.rtl) {
    feuille.views = (feuille.views ?? []).map(v => ({ ...v, rightToLeft: true }));
  }
  return feuille;
}

function ligneContexte(prep: ExportPrepare, sousTitre?: string): string[] {
  return [sousTitre ?? '', ...prep.lignesContexte].filter(s => s.trim() !== '');
}

/** Description d'une feuille de tableau (et de graphique : ses données). */
function decrireTableau(
  prep: ExportPrepare,
  nom: string,
  titre: string,
  sousTitre: string | undefined,
  modele: ModeleTableau
): DescriptionFeuille {
  const colonnes = modele.colonnes.map(c => ({ libelle: c.libelle, format: c.format }));
  const lignes = modele.lignes.map(ligne =>
    modele.colonnes.map(c => valeurBrute(ligne[c.id], c.format, prep.locale))
  );
  const libelleTotal = prep.traduire('exports.total');
  if (modele.totaux) {
    const totaux = modele.totaux;
    let indexLibelle = modele.colonnes.findIndex(c => c.type === 'dimension');
    if (indexLibelle < 0) indexLibelle = 0;
    lignes.push(
      modele.colonnes.map((c, i) =>
        i === indexLibelle ? libelleTotal : valeurBrute(totaux[c.id], c.format, prep.locale)
      )
    );
  }
  return {
    nom,
    titre,
    sousTitres: ligneContexte(prep, sousTitre),
    colonnes,
    lignes,
    // Détection indépendante de la langue : la première cellule texte vaut le libellé traduit.
    estLigneTotal: modele.totaux
      ? cellules => {
          const premiere = cellules.find(v => typeof v === 'string' && v.trim() !== '');
          return premiere === libelleTotal;
        }
      : undefined,
  };
}

function decrireIndicateurs(
  prep: ExportPrepare,
  nom: string,
  titre: string,
  sousTitre: string | undefined,
  indicateurs: IndicateurResolu[]
): DescriptionFeuille {
  const t = tableauIndicateurs(indicateurs, prep.traduire);
  const e = t.entetes;
  const ordre = [
    e.indicateur,
    e.valeur,
    e.comparaison,
    e.valeurComparaison,
    e.variation,
    e.objectif,
    e.valeurObjectif,
    e.taux,
    e.statut,
  ];
  return {
    nom,
    titre,
    sousTitres: ligneContexte(prep, sousTitre),
    colonnes: ordre.map(libelle => ({ libelle, format: t.formats[libelle] })),
    lignes: t.lignes.map(ligne =>
      ordre.map(libelle => valeurBrute(ligne[libelle], t.formats[libelle]))
    ),
    seuils: new Set([e.taux]),
  };
}

function formaterDateHeure(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(toIntlTag(locale), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function decrireProvenance(prep: ExportPrepare, nom: string): DescriptionFeuille {
  const t = prep.traduire;
  const aucun = t('exports.provenance.aucun');
  const colonnes: ColonneFeuille[] = [
    t('exports.provenance.source'),
    t('exports.provenance.periode'),
    t('exports.provenance.perimetre'),
    t('exports.provenance.filtres'),
    t('exports.provenance.regles'),
    t('exports.provenance.calculeLe'),
    t('exports.provenance.lienEcran'),
  ].map(libelle => ({ libelle, format: 'texte' as const }));

  // Champs nommés un à un : le SQL de `Provenance.sql` n'est jamais lu.
  // Deux jeux ou blocs de même provenance (lignes identiques) ne produisent qu'une ligne.
  const vues = new Set<string>();
  const lignes: string[][] = [];
  for (const p of prep.provenances) {
    const calcule = new Date(p.calculeA);
    const cellules = [
      p.libelleSource,
      p.periode?.libelle || aucun,
      p.perimetre.libelle || aucun,
      p.filtres.length > 0 ? p.filtres.map(f => `${f.libelle} : ${f.valeur}`).join(' ; ') : aucun,
      p.regles.length > 0 ? p.regles.join(' ; ') : aucun,
      Number.isNaN(calcule.getTime()) ? aucun : formaterDateHeure(calcule, prep.locale),
      p.lienEcran ? `${p.lienEcran.libelle} (${p.lienEcran.href})` : aucun,
    ];
    const cle = JSON.stringify(cellules);
    if (vues.has(cle)) continue;
    vues.add(cle);
    lignes.push(cellules);
  }
  return {
    nom,
    titre: t('exports.feuilleProvenance'),
    sousTitres: prep.exportePar
      ? [t('exports.provenance.exportePar', { nom: prep.exportePar })]
      : [],
    colonnes,
    lignes,
    estLigneTotal: () => false,
  };
}

function creerLibelles(prep: ExportPrepare): Partial<LibellesExport> {
  return {
    exporteLe: date =>
      prep.traduire('exports.exporteLe', { date: formaterDateHeure(date, prep.locale) }),
    pagination: (page, total) => prep.traduire('exports.page', { page, total }),
  };
}

/** Description de toutes les feuilles du classeur, dans l'ordre d'écriture. */
function decrireFeuilles(prep: ExportPrepare): DescriptionFeuille[] {
  const pris = new Set<string>();
  const donnees = prep.traduire('exports.feuilleDonnees');
  const feuilles: DescriptionFeuille[] = [];

  for (const bloc of prep.blocs) {
    if (bloc.type === 'texte') continue;
    if (bloc.type === 'indicateurs') {
      const nom = nomFeuilleUnique(bloc.titre || prep.traduire('exports.feuilleIndicateurs'), pris);
      feuilles.push(
        decrireIndicateurs(prep, nom, bloc.titre || prep.titre, bloc.sousTitre, bloc.indicateurs)
      );
    } else {
      const nom = nomFeuilleUnique(bloc.titre || donnees, pris);
      feuilles.push(decrireTableau(prep, nom, bloc.titre || prep.titre, bloc.sousTitre, bloc.modele));
    }
  }

  if (feuilles.length === 0) {
    feuilles.push({
      nom: nomFeuilleUnique(donnees, pris),
      titre: prep.titre,
      sousTitres: ligneContexte(prep, prep.sousTitre),
      colonnes: [],
      lignes: [],
    });
  }

  if (prep.provenances.length > 0) {
    const nom = nomFeuilleUnique(prep.traduire('exports.feuilleProvenance'), pris);
    feuilles.push(decrireProvenance(prep, nom));
  }
  return feuilles;
}

/** Construit le classeur et le rend en Buffer. */
export async function construireXlsx(prep: ExportPrepare): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  classeur.created = prep.exporteLe;
  const libelles = creerLibelles(prep);
  for (const d of decrireFeuilles(prep)) ajouterFeuille(classeur, prep, libelles, d);
  return classeurEnBuffer(classeur);
}

// ---------------------------------------------------------------------------
// Écriture en flux (gros tableaux)
// ---------------------------------------------------------------------------
//
// ExcelJS ne sait pas mettre en forme un classeur écrit en flux : `lib/excel/mise-en-forme.ts`
// relit toute la feuille (formats, largeurs, bandes, totaux) APRÈS l'avoir remplie, alors que
// le `WorkbookWriter` fige une ligne dès son `commit()`. Plutôt que de dupliquer la charte,
// on l'applique pour de vrai, mais sur une FEUILLE SONDE réduite construite par le même helper :
//
// - la sonde contient, par colonne, les valeurs qui déterminent la largeur (texte le plus long,
//   plus grand et plus petit nombre, une date, un booléen), deux lignes par genre de valeur
//   (nombre, date, texte, vide) pour relever les styles « corps » et « bande », et toutes les
//   lignes de total (au plus `TOTAUX_SONDE_MAX`) ;
// - on lit sur la sonde le bloc de titre, l'en-tête, les largeurs, le gel de volet, le filtre,
//   la mise en page et les styles ; les lignes du tableau sont ensuite écrites une à une avec
//   le style de leur rôle (corps, bande ou total) et de leur genre de valeur.
//
// Si la sonde ne couvre pas un cas (plus de `TOTAUX_SONDE_MAX` lignes de total, colonne colorée par
// seuils, style introuvable), `planifierXlsxFlux` rend `null` et l'appelant garde le chemin
// non streamé : le flux ne dégrade jamais la mise en forme.

/** Au-delà de ce nombre de lignes dans une feuille, le classeur est écrit en flux. */
export const SEUIL_XLSX_FLUX = 20_000;

/** Lignes de total au plus recopiées dans la sonde (au-delà : chemin non streamé). */
const TOTAUX_SONDE_MAX = 50;

/** Lignes écrites entre deux points de contrôle (annulation, contre-pression). */
const LIGNES_PAR_LOT = 1000;

type GenreValeur = 'nombre' | 'date' | 'texte' | 'vide';
const GENRES: GenreValeur[] = ['nombre', 'date', 'texte', 'vide'];

type ValeurCellule = string | number | boolean | Date | null;

/**
 * Valeur posée dans la cellule, comme `valeurPourCellule` du helper (non exporté) : ExcelJS
 * écrit les dates en UTC, on reporte donc les composantes locales dans une date UTC.
 */
function valeurCellule(valeur: unknown): ValeurCellule {
  if (valeur === null || valeur === undefined) return null;
  if (valeur instanceof Date) {
    if (Number.isNaN(valeur.getTime())) return null;
    return new Date(
      Date.UTC(
        valeur.getFullYear(),
        valeur.getMonth(),
        valeur.getDate(),
        valeur.getHours(),
        valeur.getMinutes(),
        valeur.getSeconds()
      )
    );
  }
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null;
  if (typeof valeur === 'boolean') return valeur;
  if (typeof valeur === 'object') return JSON.stringify(valeur);
  return String(valeur);
}

/** Genre d'une valeur DÉJÀ convertie par `valeurCellule` (celui que lit le helper dans la cellule). */
function genreDe(v: ValeurCellule): GenreValeur {
  if (v === null || v === '') return 'vide';
  if (typeof v === 'number') return 'nombre';
  if (v instanceof Date) return 'date';
  return 'texte';
}

function longueurMaxLigne(texte: string): number {
  return texte.split('\n').reduce((max, ligne) => Math.max(max, ligne.length), 0);
}

function estToutVide(valeurs: unknown[]): boolean {
  return valeurs.every(v => genreDe(valeurCellule(v)) === 'vide');
}

interface EchantillonColonne {
  genres: Set<GenreValeur>;
  premier: Partial<Record<'nombre' | 'date' | 'texte', unknown>>;
  texteLong: string | null;
  maxNombre: number | null;
  minNombre: number | null;
  booleen: boolean | null;
}

/** Ce qu'il faut écrire pour une feuille, tel que lu sur sa sonde. */
interface FeuillePlanifiee {
  desc: DescriptionFeuille;
  /** Numéro de la ligne d'en-tête (les lignes 1 à `ligneEntete` viennent de la sonde). */
  ligneEntete: number;
  sonde: ExcelJS.Worksheet;
  /** Seulement pour une grosse feuille : le corps est écrit ligne à ligne. */
  corps?: {
    nbCols: number;
    /** Style par `${répétition}|${colonne}|${genre}` (répétition 0 : corps, 1 : bande). */
    styles: Map<string, Partial<ExcelJS.Style>>;
    /** Ligne de données -> ligne de total de la sonde. */
    totaux: Map<number, number>;
  };
}

/** Planifie une grosse feuille : construit sa sonde ; `null` si la sonde ne la couvre pas. */
function planifierGrosseFeuille(
  classeurSonde: ExcelJS.Workbook,
  prep: ExportPrepare,
  libelles: Partial<LibellesExport>,
  d: DescriptionFeuille
): FeuillePlanifiee | null {
  // Les couleurs de seuil dépendent de chaque valeur : jamais en flux.
  if (d.seuils && d.seuils.size > 0) return null;
  const nbCols = d.colonnes.length;
  if (nbCols === 0) return null;
  const estTotal = d.estLigneTotal ?? (() => false);

  // Première passe, légère : rôles, genres présents, valeurs qui fixent les largeurs.
  const ech: EchantillonColonne[] = d.colonnes.map(() => ({
    genres: new Set<GenreValeur>(),
    premier: {},
    texteLong: null,
    maxNombre: null,
    minNombre: null,
    booleen: null,
  }));
  const indicesTotaux: number[] = [];
  d.lignes.forEach((valeurs, i) => {
    if (estToutVide(valeurs)) return;
    if (estTotal(valeurs)) {
      indicesTotaux.push(i);
      return;
    }
    for (let c = 0; c < nbCols; c += 1) {
      const e = ech[c];
      const brute = valeurs[c];
      const v = valeurCellule(brute);
      const genre = genreDe(v);
      e.genres.add(genre);
      if (v === null || genre === 'vide') continue;
      if (genre === 'nombre') {
        const n = v as number;
        e.premier.nombre ??= brute;
        if (e.maxNombre === null || n > e.maxNombre) e.maxNombre = n;
        if (e.minNombre === null || n < e.minNombre) e.minNombre = n;
      } else if (genre === 'date') {
        e.premier.date ??= brute;
      } else if (typeof v === 'boolean') {
        e.premier.texte ??= brute;
        // `false` (5 caractères) l'emporte sur `true` (4).
        if (e.booleen === null || v === false) e.booleen = v;
      } else {
        e.premier.texte ??= brute;
        const texte = String(v);
        if (e.texteLong === null || longueurMaxLigne(texte) > longueurMaxLigne(e.texteLong)) {
          e.texteLong = texte;
        }
      }
    }
  });
  if (indicesTotaux.length > TOTAUX_SONDE_MAX) return null;

  // Lignes de la sonde : styles (deux lignes par genre), puis largeurs, puis totaux.
  const sonde: unknown[][] = [];
  const positions = new Map<string, number>(); // `${rep}|${genre}` -> index dans `sonde`
  const rempli = (c: number): unknown =>
    ech[c].premier.nombre ?? ech[c].premier.date ?? ech[c].premier.texte ?? null;
  // « vide » en dernier : une ligne toute vide serait sautée par le helper (et décalerait les bandes).
  for (const genre of GENRES) {
    if (!ech.some(e => e.genres.has(genre))) continue;
    for (const rep of [0, 1]) {
      positions.set(`${rep}|${genre}`, sonde.length);
      sonde.push(
        ech.map((e, c) => {
          if (!e.genres.has(genre)) return rempli(c);
          return genre === 'vide' ? null : e.premier[genre];
        })
      );
    }
  }
  const ajouterLargeur = (extrait: (e: EchantillonColonne) => unknown) => {
    const ligne = ech.map(e => extrait(e) ?? null);
    if (ligne.some(v => v !== null)) sonde.push(ligne);
  };
  ajouterLargeur(e => e.texteLong);
  ajouterLargeur(e => e.maxNombre);
  ajouterLargeur(e => (e.minNombre !== e.maxNombre ? e.minNombre : null));
  ajouterLargeur(e => e.premier.date);
  ajouterLargeur(e => e.booleen);
  // Une ligne de la sonde ne doit jamais être prise pour un total par le helper.
  for (const ligne of sonde) {
    if (!estToutVide(ligne) && estTotal(ligne)) return null;
  }
  const totaux = new Map<number, number>();
  const ligneEntete = d.sousTitres.filter(s => s.trim() !== '').length + 4;
  for (const i of indicesTotaux) {
    totaux.set(i, ligneEntete + 1 + sonde.length);
    sonde.push(d.lignes[i]);
  }

  const feuille = ajouterFeuille(classeurSonde, prep, libelles, { ...d, lignes: sonde });

  // Styles relevés sur la sonde, par (répétition, colonne, genre).
  const styles = new Map<string, Partial<ExcelJS.Style>>();
  for (const [cle, index] of positions) {
    const [rep, genre] = cle.split('|');
    for (let c = 0; c < nbCols; c += 1) {
      if (!ech[c].genres.has(genre as GenreValeur)) continue;
      const style = feuille.getRow(ligneEntete + 1 + index).getCell(c + 1).style as
        | Partial<ExcelJS.Style>
        | undefined;
      if (!style || Object.keys(style).length === 0) return null;
      styles.set(`${rep}|${c}|${genre}`, style);
    }
  }
  return { desc: d, ligneEntete, sonde: feuille, corps: { nbCols, styles, totaux } };
}

interface PlanFeuilles {
  feuilles: FeuillePlanifiee[];
  prep: ExportPrepare;
}

export interface PlanXlsxFlux {
  /** Démarre l'écriture et rend le flux d'octets du classeur (annulable par le lecteur). */
  creerFlux(): ReadableStream<Uint8Array>;
}

/**
 * Prépare l'écriture en flux. Rend `null` quand le chemin non streamé s'impose : aucune feuille
 * au-dessus de `seuil` lignes, ou une feuille que la sonde ne couvre pas. Tout le calcul
 * (sondes, largeurs) est fait ici, avant le moindre octet : une erreur est levée avant le flux.
 */
export function planifierXlsxFlux(
  prep: ExportPrepare,
  seuil: number = SEUIL_XLSX_FLUX
): PlanXlsxFlux | null {
  const descriptions = decrireFeuilles(prep);
  if (!descriptions.some(d => d.lignes.length > seuil)) return null;

  const libelles = creerLibelles(prep);
  const classeurSonde = new ExcelJS.Workbook();
  const feuilles: FeuillePlanifiee[] = [];
  for (const d of descriptions) {
    if (d.lignes.length > seuil) {
      const grosse = planifierGrosseFeuille(classeurSonde, prep, libelles, d);
      if (!grosse) return null;
      feuilles.push(grosse);
    } else {
      // Petite feuille : construite en entier par le helper, puis recopiée telle quelle.
      const sonde = ajouterFeuille(classeurSonde, prep, libelles, d);
      feuilles.push({
        desc: d,
        ligneEntete: d.sousTitres.filter(s => s.trim() !== '').length + 4,
        sonde,
      });
    }
  }
  const plan: PlanFeuilles = { feuilles, prep };
  return { creerFlux: () => creerFluxXlsx(plan) };
}

class EcritureAnnulee extends Error {
  constructor() {
    super('Écriture annulée');
    this.name = 'EcritureAnnulee';
  }
}

const attendre = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** styles.xml au format Excel 2007, par le même correctif que `classeurEnBuffer`. */
async function stylesExcel2007(xml: string): Promise<string> {
  const entree = new JSZip();
  entree.file('xl/styles.xml', xml);
  const zip = await entree.generateAsync({ type: 'nodebuffer' });
  const corrige = await JSZip.loadAsync(await compatibiliserExcel2007(zip));
  return (await corrige.file('xl/styles.xml')?.async('string')) ?? xml;
}

/** Recopie les lignes 1 à `jusqua` de la sonde (valeurs, styles, hauteurs) dans le flux. */
function recopierLignes(
  ws: ExcelJS.Worksheet,
  sonde: ExcelJS.Worksheet,
  jusqua: number
): void {
  for (let r = 1; r <= jusqua; r += 1) {
    const source = sonde.findRow(r);
    if (!source) continue;
    const ligne = ws.getRow(r);
    if (source.height) ligne.height = source.height;
    source.eachCell({ includeEmpty: true }, (cellule, c) => {
      // Cellule fusionnée non maîtresse : `mergeCells` s'en charge.
      if (cellule.master && cellule.master !== cellule) return;
      const cible = ligne.getCell(c);
      if (cellule.value !== null && cellule.value !== undefined) cible.value = cellule.value;
      cible.style = cellule.style;
    });
  }
}

async function ecrireClasseur(
  plan: PlanFeuilles,
  sortie: PassThrough,
  annule: () => boolean
): Promise<void> {
  const { prep, feuilles } = plan;
  // Créateur du classeur de référence (celui que produit le chemin non streamé) : jamais recopié ici.
  const createur = feuilles[0].sonde.workbook.creator;
  const ecrivain = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: sortie,
    useStyles: true,
    // Chaînes en ligne : pas de table de chaînes partagées à garder en mémoire.
    useSharedStrings: false,
    // Options lues par ExcelJS mais absentes de ses types.
    ...({ creator: createur, created: prep.exporteLe, modified: prep.exporteLe } as object),
  });
  const interne = ecrivain as unknown as {
    lastModifiedBy: string;
    title: string;
    styles: { xml: string };
    zip: { append(contenu: string, options: { name: string }): void };
    addStyles(): Promise<void>;
  };
  interne.lastModifiedBy = 'Unknown';
  interne.title = feuilles[feuilles.length - 1].desc.titre;
  // Compatibilité Excel 2007 : mêmes polices réordonnées que `classeurEnBuffer`, sur styles.xml seul.
  interne.addStyles = async () => {
    interne.zip.append(await stylesExcel2007(interne.styles.xml), { name: 'xl/styles.xml' });
  };

  try {
    await ecrireFeuilles(ecrivain, feuilles, sortie, annule);
    await ecrivain.commit();
  } catch (erreur) {
    // Arrête l'archive en cours : plus rien n'est écrit ni gardé en mémoire.
    (interne.zip as unknown as { abort?: () => void }).abort?.();
    throw erreur;
  }
}

async function ecrireFeuilles(
  ecrivain: ExcelJS.stream.xlsx.WorkbookWriter,
  feuilles: FeuillePlanifiee[],
  sortie: PassThrough,
  annule: () => boolean
): Promise<void> {
  const verifier = () => {
    if (annule()) throw new EcritureAnnulee();
  };

  for (const f of feuilles) {
    const { sonde, ligneEntete, desc } = f;
    // Vues, mise en page et filtre sont lus à la création de la feuille (le filtre à sa fermeture).
    const ws = ecrivain.addWorksheet(sonde.name, {
      views: sonde.views as ExcelJS.WorksheetView[],
      pageSetup: sonde.pageSetup,
      headerFooter: sonde.headerFooter,
      ...({ autoFilter: sonde.autoFilter } as object),
    }) as unknown as ExcelJS.Worksheet & { commit(): void };
    // Largeurs avant la première ligne : ExcelJS écrit <cols> à ce moment.
    const nbCols = f.corps?.nbCols ?? sonde.columnCount;
    for (let c = 1; c <= nbCols; c += 1) {
      const largeur = sonde.getColumn(c).width;
      if (largeur) ws.getColumn(c).width = largeur;
    }
    const jusqua = f.corps ? ligneEntete : sonde.rowCount;
    recopierLignes(ws, sonde, jusqua);
    for (const fusion of sonde.model.merges ?? []) ws.mergeCells(fusion);
    for (let r = 1; r <= jusqua; r += 1) ws.findRow(r)?.commit();

    if (f.corps) {
      const { styles, totaux } = f.corps;
      let rang = 0;
      for (let i = 0; i < desc.lignes.length; i += 1) {
        if (i % LIGNES_PAR_LOT === 0) {
          verifier();
          // Contre-pression : on attend que le client lise avant d'en écrire davantage.
          while (sortie.readableLength >= sortie.readableHighWaterMark && !sortie.destroyed) {
            await attendre(5);
          }
          verifier();
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        const valeurs = desc.lignes[i].map(valeurCellule);
        if (valeurs.every(v => genreDe(v) === 'vide')) continue;
        const ligne = ws.getRow(ligneEntete + 1 + i);
        const numeroTotal = totaux.get(i);
        const bande = numeroTotal === undefined && rang % 2 === 1;
        if (numeroTotal === undefined) rang += 1;
        for (let c = 0; c < nbCols; c += 1) {
          const cellule = ligne.getCell(c + 1);
          const valeur = valeurs[c] ?? null;
          if (valeur !== null) cellule.value = valeur;
          cellule.style =
            numeroTotal !== undefined
              ? (sonde.getRow(numeroTotal).getCell(c + 1).style as Partial<ExcelJS.Style>)
              : (styles.get(`${bande ? 1 : 0}|${c}|${genreDe(valeur)}`) ?? {});
        }
        ligne.commit();
      }
    }
    verifier();
    ws.commit();
  }
  verifier();
}

/** Flux web des octets du classeur ; l'annulation du lecteur arrête l'écriture. */
function creerFluxXlsx(plan: PlanFeuilles): ReadableStream<Uint8Array> {
  const sortie = new PassThrough();
  ecrireClasseur(plan, sortie, () => sortie.destroyed).catch(erreur => {
    // Annulation : le lecteur est déjà parti, rien à signaler. Sinon le flux est en erreur.
    if (!(erreur instanceof EcritureAnnulee)) sortie.destroy(erreur as Error);
  });
  return Readable.toWeb(sortie) as unknown as ReadableStream<Uint8Array>;
}
