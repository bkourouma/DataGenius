/**
 * Mise en forme commune des exports Excel (charte "conseil d'administration").
 *
 * Module isomorphe : utilisable dans le navigateur et sur le serveur. Il ne
 * depend que des types ExcelJS ; le classeur est fourni par l'appelant.
 *
 * Deux points d'entree :
 * - construireFeuille : cree une feuille a partir de lignes d'objets ;
 * - presenterFeuille : met en forme sur place une feuille deja remplie.
 */

import type ExcelJS from 'exceljs';
import { compatibiliserExcel2007Octets } from '@/lib/utils/compatibilite-excel';
import { SEUIL_TAUX_ALERTE, SEUIL_TAUX_ATTEINT } from '@/lib/donnees/seuils-taux';

export type FormatColonne =
  | 'texte'
  | 'code'
  | 'entier'
  | 'decimal'
  | 'montant'
  | 'pourcentage'
  | 'ratio'
  | 'date';

export interface OptionsColonne {
  format?: FormatColonne;
  largeur?: number;
  /**
   * Colore les cellules selon les seuils de taux de realisation (SEUIL_TAUX_ALERTE / SEUIL_TAUX_ATTEINT)
   * (rouge, orange, vert). Vrai : toujours ; faux : jamais ; absent : deduit du
   * libelle (colonne de realisation au format pourcentage ou ratio).
   */
  seuils?: boolean;
}

export interface LibellesExport {
  /** Ligne "Exporté le ..." du bloc de titre et du pied de page. */
  exporteLe: (date: Date) => string;
  /** Appele avec ('&P', '&N') pour le pied de page Excel. */
  pagination: (page: string, total: string) => string;
}

export interface OptionsMiseEnForme {
  titre?: string;
  /** Periode, filtres, perimetre : une ligne par element. */
  sousTitre?: string | string[];
  /** Par LIBELLE d'en-tete ; prioritaire sur la deduction. */
  colonnes?: Record<string, OptionsColonne>;
  libelles?: Partial<LibellesExport>;
  /** Recoit les valeurs de la ligne ; par defaut la 1re cellule texte commence par "total". */
  estLigneTotal?: (cellules: unknown[]) => boolean;
  /** Injectable pour les tests ; defaut new Date(). */
  dateExport?: Date;
}

export interface OptionsPresenter extends OptionsMiseEnForme {
  /** 1-based : ligne de l'en-tete dans la feuille deja remplie. */
  ligneEntete: number;
  /**
   * Faux (defaut) : aucune ligne ajoutee, aucune valeur deplacee.
   * Vrai : le bloc de titre est insere juste au-dessus de l'en-tete avec
   * spliceRows. ExcelJS ne deplace PAS les fusions existantes : a n'utiliser
   * que sur une feuille sans cellules fusionnees.
   */
  insererTitre?: boolean;
}

// ---------------------------------------------------------------------------
// Constantes de charte
// ---------------------------------------------------------------------------

const BLEU_NUIT = 'FF1F3864';
const BLEU_QUANTITE = 'FF2F6BCB';
const VERT_MONTANT = 'FF0F766E';
const AMBRE_TAUX = 'FFB45309';
const GRIS_TEXTE = 'FF595959';
const GRIS_BORDURE = 'FFD9E1EA';
const BANDE = 'FFF5F8FC';
const FOND_TOTAL = 'FFDCE6F2';

const NUM_FMT: Record<FormatColonne, string | undefined> = {
  texte: undefined,
  code: '0',
  entier: '#,##0;[Red]-#,##0',
  decimal: '#,##0.00;[Red]-#,##0.00',
  montant: '#,##0.00;[Red]-#,##0.00',
  pourcentage: '0.0" %";[Red]-0.0" %"',
  ratio: '0.0%;[Red]-0.0%',
  date: 'dd/mm/yyyy',
};

const LARGEUR_MIN = 8;
const LARGEUR_MAX = 50;

const LIBELLES_DEFAUT: LibellesExport = {
  exporteLe: (date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `Exporté le ${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} à ${p(date.getHours())}:${p(date.getMinutes())}`;
  },
  pagination: (page, total) => `Page ${page} sur ${total}`,
};

// ---------------------------------------------------------------------------
// Utilitaires de texte
// ---------------------------------------------------------------------------

/** Minuscules sans accents, pour comparer les libelles. */
function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Nom de feuille accepte par Excel 2007 : 31 car. max, sans [ ] : * ? / \ ni apostrophe droite. */
export function nomFeuilleValide(nom: string): string {
  const propre = String(nom ?? '')
    .replace(/[[\]:*?/\\]/g, '')
    .replace(/'/g, '’')
    .trim()
    .slice(0, 31)
    .trim();
  return propre || 'Export';
}

// ---------------------------------------------------------------------------
// Deduction du format
// ---------------------------------------------------------------------------

/**
 * Expression "mot entier" (frontieres hors lettres/chiffres) sur un libelle
 * normalise. Les mots courts (ca, id, tx, num) ne matchent donc jamais a
 * l'interieur d'un mot (capacite, produit). Les radicaux se terminent par `*`
 * et acceptent alors une suite de lettres.
 */
function motsEntiers(mots: string[], auDebut = false): RegExp {
  const alternatives = mots.map((m) => {
    const radical = m.endsWith('*');
    const brut = (radical ? m.slice(0, -1) : m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return radical ? `${brut}[a-z]*` : `${brut}s?`;
  });
  const debut = auDebut ? '^[^a-z0-9]*' : '(?:^|[^a-z0-9])';
  return new RegExp(`${debut}(?:${alternatives.join('|')})(?![a-z0-9])`);
}

// Taux : fr, en, es (le "%" seul est teste a part, il n'a pas de frontiere de mot).
const RE_TAUX = motsEntiers([
  'taux', 'tx', 'realis*', 'evol*', 'part', 'ratio', 'rate', 'achievement', 'growth',
  'share', 'tasa', 'cumplimiento', 'crecimiento', 'porcentaje', 'cuota', 'progression',
]);
// Code, annee, mois, periode, identifiant.
// Seul le premier mot compte : « Code produit » est un code, « Quantité vendue sur la période » non.
const RE_CODE = motsEntiers(
  [
    'code', 'annee', 'mois', 'periode', 'n°', 'no', 'num', 'numero', 'id', 'year', 'month',
    'period', 'ano', 'mes', 'periodo', 'codigo', 'ref', 'reference',
  ],
  true
);
// Montant.
const RE_MONTANT = motsEntiers([
  'montant', 'ca', "chiffre d'affaires", 'chiffre d affaires', 'eur', '€', 'prix', 'pght',
  'valeur', 'amount', 'revenue', 'price', 'value', 'turnover', 'budget', 'importe',
  'precio', 'valor', 'ventas',
]);

// Colonnes de realisation (seules colorees par les seuils ; pas les evolutions ni les parts).
const RE_REALISATION = motsEntiers([
  'real', 'realis*', 'realiz*', 'achievement', 'achieved', 'cumplimiento', 'atteint*', 'alcanzad*',
]);

function estVide(valeur: unknown): boolean {
  return (
    valeur === null ||
    valeur === undefined ||
    valeur === '' ||
    (typeof valeur === 'number' && !Number.isFinite(valeur))
  );
}

/**
 * Deduit le format d'une colonne d'apres son libelle et ses valeurs (celles des
 * lignes hors total). Une chaine n'est jamais convertie en nombre.
 */
export function deduireFormat(libelle: string, valeurs: unknown[]): FormatColonne {
  const pleines = valeurs.filter((v) => !estVide(v));
  if (pleines.length === 0) return 'texte';

  if (pleines.every((v) => v instanceof Date)) return 'date';
  if (!pleines.every((v) => typeof v === 'number')) return 'texte';

  const nombres = pleines as number[];
  const l = normaliser(libelle);

  // Ordre : "Taux" avant tout, puis code/annee (pour qu'"Annee" ne soit pas un montant), puis montant.
  // Un libelle avec « % » est en points, jamais en ratio (« Evolution % » a 0,4 = 0,4 %, pas 40 %).
  if (l.includes('%')) return 'pourcentage';
  if (RE_TAUX.test(l)) {
    const max = Math.max(...nombres.map((n) => Math.abs(n)));
    return max <= 1.5 ? 'ratio' : 'pourcentage';
  }
  if (RE_CODE.test(l)) return 'code';
  if (RE_MONTANT.test(l)) return 'montant';
  return nombres.every((n) => Number.isInteger(n)) ? 'entier' : 'decimal';
}

// ---------------------------------------------------------------------------
// Lecture / normalisation des valeurs
// ---------------------------------------------------------------------------

/**
 * ExcelJS ecrit les dates en UTC : une date a minuit local (UTC+2) s'afficherait
 * la veille. On reporte donc les composantes locales dans une date UTC.
 */
function dateLocaleEnUtc(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds()
    )
  );
}

/** Valeur ecrite dans la cellule a partir d'une valeur d'objet source. */
function valeurPourCellule(valeur: unknown): string | number | boolean | Date | null {
  if (valeur === null || valeur === undefined) return null;
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : dateLocaleEnUtc(valeur);
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null;
  // Vrai booleen : Excel l'affiche dans la langue de l'utilisateur (VRAI/FAUX, TRUE/FALSE...).
  if (typeof valeur === 'boolean') return valeur;
  if (typeof valeur === 'object') return JSON.stringify(valeur);
  return String(valeur);
}

/** Valeur lisible d'une cellule ExcelJS : formule (resultat), texte riche, lien, date. */
function lireValeur(valeur: unknown): unknown {
  if (valeur === null || valeur === undefined) return null;
  if (valeur instanceof Date || typeof valeur !== 'object') {
    return valeur;
  }
  const objet = valeur as Record<string, unknown>;
  if ('result' in objet) return lireValeur(objet.result);
  if (Array.isArray(objet.richText)) {
    return (objet.richText as { text?: string }[]).map((p) => p.text ?? '').join('');
  }
  if (typeof objet.text === 'string') return objet.text;
  if (typeof objet.error === 'string') return objet.error;
  if ('formula' in objet || 'sharedFormula' in objet) return null;
  return JSON.stringify(valeur);
}

function normaliserTexteTotal(cellules: unknown[]): string | null {
  const premiere = cellules.find((v) => typeof v === 'string' && v.trim() !== '');
  return premiere === undefined ? null : normaliser((premiere as string).trim());
}

function estTotalParDefaut(cellules: unknown[]): boolean {
  const texte = normaliserTexteTotal(cellules);
  // Totaux et sous-totaux (fr, en, es) ont le meme style ; seule la derniere ligne a la bordure double.
  return (
    texte !== null &&
    /^(sous[- ]?)?(total|totals|totaux|totales?|subtotal|subtotales?|subtotals)(?![a-z])/.test(texte)
  );
}

type NiveauSeuil = 'bas' | 'moyen' | 'haut';

const COULEURS_SEUIL: Record<NiveauSeuil, { fond: string; texte: string }> = {
  bas: { fond: 'FFFDE2E2', texte: 'FFB91C1C' },
  moyen: { fond: 'FFFEF3C7', texte: 'FF92400E' },
  haut: { fond: 'FFDCFCE7', texte: 'FF166534' },
};

/** Niveau d'un taux de realisation : < 70 bas, < 90 moyen, sinon haut. */
function niveauSeuil(valeur: number, format: FormatColonne): NiveauSeuil {
  // Arrondi a 1e-6 : 0.7 * 100 vaut 70.00000000000001, 0.29 * 100 vaut 28.999999999999996.
  const points = format === 'ratio' ? Math.round(valeur * 100 * 1e6) / 1e6 : valeur;
  if (points < SEUIL_TAUX_ALERTE) return 'bas';
  if (points < SEUIL_TAUX_ATTEINT) return 'moyen';
  return 'haut';
}

// ---------------------------------------------------------------------------
// Largeurs : estimation du texte affiche
// ---------------------------------------------------------------------------

function avecSeparateurs(entier: string): string {
  return entier.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function nombreAffiche(valeur: number, decimales: number): string {
  const fixe = Math.abs(valeur).toFixed(decimales);
  const [entier, fraction] = fixe.split('.');
  const signe = valeur < 0 && Number(fixe) !== 0 ? '-' : '';
  return `${signe}${avecSeparateurs(entier)}${fraction ? `.${fraction}` : ''}`;
}

function longueurAffichee(valeur: unknown, format: FormatColonne): number {
  if (estVide(valeur)) return 0;
  if (valeur instanceof Date) return 10;
  if (typeof valeur === 'number') {
    switch (format) {
      case 'code':
        return String(Math.round(valeur)).length;
      case 'entier':
        return nombreAffiche(valeur, 0).length;
      case 'pourcentage':
        return nombreAffiche(valeur, 1).length + 2;
      case 'ratio':
        return nombreAffiche(valeur * 100, 1).length + 1;
      default:
        return nombreAffiche(valeur, 2).length;
    }
  }
  // Texte : la plus longue ligne si la cellule est sur plusieurs lignes.
  return String(valeur)
    .split('\n')
    .reduce((max, ligne) => Math.max(max, ligne.length), 0);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

type Famille = 'dimension' | 'quantite' | 'montant' | 'taux';

function familleDe(format: FormatColonne): Famille {
  if (format === 'entier' || format === 'decimal') return 'quantite';
  if (format === 'montant') return 'montant';
  if (format === 'pourcentage' || format === 'ratio') return 'taux';
  return 'dimension';
}

const FOND_ENTETE: Record<Famille, string> = {
  dimension: BLEU_NUIT,
  quantite: BLEU_QUANTITE,
  montant: VERT_MONTANT,
  taux: AMBRE_TAUX,
};

function aplat(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

const BORD_FIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: GRIS_BORDURE } };
const BORDURES_CORPS: Partial<ExcelJS.Borders> = {
  top: BORD_FIN,
  left: BORD_FIN,
  bottom: BORD_FIN,
  right: BORD_FIN,
};

function bordureTotal(style: 'medium' | 'double'): Partial<ExcelJS.Borders> {
  return { ...BORDURES_CORPS, top: { style, color: { argb: BLEU_NUIT } } };
}

/** Echappe les & du texte libre pour les en-tetes/pieds de page Excel. */
function echapperEntetePied(texte: string): string {
  return texte.replace(/&/g, '&&');
}

type RoleLigne = 'corps' | 'bande' | 'total' | 'total-double';

type Plat = Record<string, unknown>;

/** Copie un objet a un niveau, et ses sous-objets (couleur...) un niveau plus bas. */
function copierObjet<T>(objet: T): T {
  if (objet === null || typeof objet !== 'object') return objet;
  const copie: Plat = { ...(objet as Plat) };
  for (const cle in copie) {
    const v = copie[cle];
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) copie[cle] = { ...(v as Plat) };
  }
  return copie as T;
}

/**
 * Copie d'un modele de style : chaque cellule garde le sien, modifiable sans effet sur les autres.
 * Ecrite pour la structure d'ExcelJS (bordure : cote > couleur, fond : fgColor...), bien plus
 * rapide qu'une copie recursive generique.
 */
function cloner(style: Partial<ExcelJS.Style>): Partial<ExcelJS.Style> {
  const copie: Partial<ExcelJS.Style> = {};
  if (style.font) copie.font = copierObjet(style.font);
  if (style.fill) copie.fill = copierObjet(style.fill);
  if (style.alignment) copie.alignment = { ...style.alignment };
  if (style.numFmt) copie.numFmt = style.numFmt;
  if (style.protection) copie.protection = copierObjet(style.protection);
  if (style.border) {
    const bordure: Plat = {};
    for (const cote of Object.keys(style.border)) {
      bordure[cote] = copierObjet((style.border as Plat)[cote]);
    }
    copie.border = bordure as Partial<ExcelJS.Borders>;
  }
  return copie;
}

/**
 * Modeles de style, un par combinaison. Ils ne sont jamais poses tels quels sur une cellule :
 * appliquerStyle en donne une copie, car les setters d'ExcelJS (cellule.numFmt = ...) modifient
 * l'objet de style en place. Le partage se fait seulement a l'ecriture (voir classeurEnOctets).
 */
const STYLES_ENTETE = new Map<Famille, Partial<ExcelJS.Style>>();
const STYLES_CORPS = new Map<string, Partial<ExcelJS.Style>>();

function styleEntete(famille: Famille): Partial<ExcelJS.Style> {
  let style = STYLES_ENTETE.get(famille);
  if (!style) {
    style = ({
      font: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } },
      fill: aplat(FOND_ENTETE[famille]),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: { ...BORDURES_CORPS },
    });
    STYLES_ENTETE.set(famille, style);
  }
  return style;
}

/** Format de nombre ecrit dans la cellule (aucun pour une valeur texte). */
function numFmtPour(format: FormatColonne, valeur: unknown): string | undefined {
  const fmt = NUM_FMT[format];
  if (fmt && (typeof valeur === 'number' || valeur instanceof Date || estVide(valeur))) return fmt;
  if (valeur instanceof Date) return NUM_FMT.date;
  return undefined;
}

function styleCorps(
  role: RoleLigne,
  format: FormatColonne,
  numFmt: string | undefined,
  niveau: NiveauSeuil | null
): Partial<ExcelJS.Style> {
  const cle = `${role}|${format}|${numFmt ?? ''}|${niveau ?? ''}`;
  let style = STYLES_CORPS.get(cle);
  if (style) return style;

  const total = role === 'total' || role === 'total-double';
  const numerique = familleDe(format) !== 'dimension' || format === 'code';
  const couleurs = niveau ? COULEURS_SEUIL[niveau] : null;
  const brut: Partial<ExcelJS.Style> = {
    font: couleurs
      ? { name: 'Calibri', size: 10, bold: total, color: { argb: couleurs.texte } }
      : { name: 'Calibri', size: 10, bold: total },
    alignment: {
      horizontal: format === 'date' ? 'center' : numerique ? 'right' : 'left',
      vertical: 'middle',
    },
    border: total ? bordureTotal(role === 'total-double' ? 'double' : 'medium') : { ...BORDURES_CORPS },
  };
  // Couleur statique (pas de mise en forme conditionnelle : Excel 2007). Un total garde son fond.
  if (total) brut.fill = aplat(FOND_TOTAL);
  else if (couleurs) brut.fill = aplat(couleurs.fond);
  else if (role === 'bande') brut.fill = aplat(BANDE);
  if (numFmt) brut.numFmt = numFmt;
  style = brut;
  STYLES_CORPS.set(cle, style);
  return style;
}

/**
 * Affecte une copie du modele. Une propriete que le style ne definit pas (fond, format de nombre,
 * protection) reste celle de la cellule, comme avec des affectations propriete par propriete.
 */
function appliquerStyle(cellule: ExcelJS.Cell, style: Partial<ExcelJS.Style>): void {
  // Cellule fusionnee non maitre : ExcelJS lui fait partager l'objet de style du maitre (mergeCells),
  // pour qu'un setter pose ensuite sur le maitre suive. Le maitre (en haut a gauche) est parcouru avant.
  const maitre = cellule.master;
  if (maitre && maitre !== cellule) {
    cellule.style = maitre.style;
    return;
  }
  const base = cellule.style as Partial<ExcelJS.Style> | undefined;
  if (base && ((!style.fill && base.fill) || (!style.numFmt && base.numFmt) || base.protection)) {
    const fusion: Partial<ExcelJS.Style> = { ...style };
    if (!fusion.fill && base.fill) fusion.fill = base.fill;
    if (!fusion.numFmt && base.numFmt) fusion.numFmt = base.numFmt;
    if (base.protection) fusion.protection = base.protection;
    cellule.style = cloner(fusion);
    return;
  }
  cellule.style = cloner(style);
}

// Hauteur de la ligne d'en-tete (points) : deux lignes de texte au minimum, puis ~15 pt par ligne.
const HAUTEUR_ENTETE_MIN = 30;
const HAUTEUR_PAR_LIGNE = 15;
const MARGE_ENTETE = 3;
/** Place reservee au bouton du filtre automatique, en caracteres. */
const PLACE_FILTRE = 4;

/** Nombre de lignes d'un libelle, par retour a la ligne mot a mot dans `utile` caracteres. */
function lignesEntete(libelle: string, utile: number): number {
  let total = 0;
  for (const paragraphe of libelle.split('\n')) {
    let lignes = 1;
    let courante = 0;
    for (const mot of paragraphe.split(/\s+/).filter((m) => m !== '')) {
      if (courante === 0) {
        courante = mot.length;
      } else if (courante + 1 + mot.length <= utile) {
        courante += 1 + mot.length;
      } else {
        lignes += 1;
        courante = mot.length;
      }
      // Un mot plus long que la colonne est coupe sur plusieurs lignes.
      while (courante > utile) {
        lignes += 1;
        courante -= utile;
      }
    }
    total += lignes;
  }
  return total;
}

/** Hauteur de l'en-tete : celle de la colonne qui exige le plus de lignes, jamais sous 30 pt. */
export function hauteurEntete(libelles: string[], largeurs: number[]): number {
  let maxLignes = 1;
  libelles.forEach((libelle, i) => {
    const utile = Math.max(Math.floor(largeurs[i] - PLACE_FILTRE), 1);
    maxLignes = Math.max(maxLignes, lignesEntete(libelle.trim(), utile));
  });
  return maxLignes <= 2 ? HAUTEUR_ENTETE_MIN : maxLignes * HAUTEUR_PAR_LIGNE + MARGE_ENTETE;
}

interface ContexteStyle {
  ligneEntete: number;
  titre: string;
  options: OptionsMiseEnForme;
  libelles: LibellesExport;
  dateExport: Date;
}

/** Applique styles, formats, largeurs, filtre, volet et impression a un tableau deja rempli. */
function mettreEnForme(feuille: ExcelJS.Worksheet, ctx: ContexteStyle): void {
  const { ligneEntete, options } = ctx;
  const enteteLigne = feuille.getRow(ligneEntete);
  const nbCols = enteteLigne.cellCount;
  if (nbCols === 0) return;

  const estTotal = options.estLigneTotal ?? estTotalParDefaut;
  const derniere = feuille.rowCount;

  // Lecture de la feuille : libelles, valeurs par ligne, lignes de total.
  const libellesCols: string[] = [];
  for (let c = 1; c <= nbCols; c += 1) {
    const v = lireValeur(enteteLigne.getCell(c).value);
    libellesCols.push(v === null || v === undefined ? '' : String(v));
  }

  interface LigneLue {
    numero: number;
    valeurs: unknown[];
    total: boolean;
  }
  const lignes: LigneLue[] = [];
  for (let r = ligneEntete + 1; r <= derniere; r += 1) {
    const ligne = feuille.getRow(r);
    const valeurs: unknown[] = [];
    for (let c = 1; c <= nbCols; c += 1) valeurs.push(lireValeur(ligne.getCell(c).value));
    if (valeurs.every(estVide)) continue;
    lignes.push({ numero: r, valeurs, total: estTotal(valeurs) });
  }

  // Formats : option explicite, sinon deduction sur les lignes hors total.
  // Une colonne entierement vide (mois futurs d'un pivot) reprend le format numerique de la precedente.
  const NUMERIQUES: FormatColonne[] = ['entier', 'decimal', 'montant', 'pourcentage', 'ratio'];
  const formats: FormatColonne[] = [];
  libellesCols.forEach((libelle, i) => {
    const explicite = options.colonnes?.[libelle]?.format;
    if (explicite) {
      formats.push(explicite);
      return;
    }
    const valeursCol = lignes.filter((l) => !l.total).map((l) => l.valeurs[i]);
    if (valeursCol.every(estVide) && i > 0 && NUMERIQUES.includes(formats[i - 1])) {
      formats.push(formats[i - 1]);
      return;
    }
    formats.push(deduireFormat(libelle, valeursCol));
  });

  // Colonnes colorees par les seuils de realisation : option explicite, sinon deduction par libelle.
  const colonneSeuils = libellesCols.map((libelle, i) => {
    const explicite = options.colonnes?.[libelle]?.seuils;
    if (explicite !== undefined) return explicite;
    return (
      (formats[i] === 'pourcentage' || formats[i] === 'ratio') &&
      RE_REALISATION.test(normaliser(libelle))
    );
  });

  // Largeurs : contenu affiche + 2, borne ; l'en-tete compte par son mot le plus long.
  const largeurs: number[] = [];
  for (let c = 1; c <= nbCols; c += 1) {
    const imposee = options.colonnes?.[libellesCols[c - 1]]?.largeur;
    if (imposee !== undefined) {
      largeurs.push(imposee);
      continue;
    }
    // En-tete : s'il est court (18 car. ou moins) il tient sur une ligne a cote de la fleche du
    // filtre automatique (+ 4) ; sinon il passe a la ligne et seul son mot le plus long compte.
    const entete = libellesCols[c - 1].trim();
    const motLong = entete.split(/\s+/).reduce((m, mot) => Math.max(m, mot.length), 0);
    let besoin = (entete.length <= 18 ? entete.length : motLong) + 4;
    for (const l of lignes) besoin = Math.max(besoin, longueurAffichee(l.valeurs[c - 1], formats[c - 1]) + 2);
    const largeur = Math.min(Math.max(besoin, LARGEUR_MIN), LARGEUR_MAX);
    // ExcelJS n'ecrit pas une colonne de largeur 9 (sa largeur par defaut) : on l'ecarte d'un cheveu.
    largeurs.push(largeur === 9 ? 9.1 : largeur);
  }
  largeurs.forEach((largeur, i) => {
    feuille.getColumn(i + 1).width = largeur;
  });

  // En-tete : la hauteur suit la colonne dont le libelle exige le plus de lignes.
  enteteLigne.height = hauteurEntete(libellesCols, largeurs);
  for (let c = 1; c <= nbCols; c += 1) {
    appliquerStyle(enteteLigne.getCell(c), styleEntete(familleDe(formats[c - 1])));
  }

  // Corps : styles partages (un objet par combinaison, pas un objet par cellule).
  const derniereTotal = [...lignes].reverse().find((l) => l.total)?.numero ?? -1;
  let rangCorps = 0;
  for (const l of lignes) {
    const ligne = feuille.getRow(l.numero);
    const bande = !l.total && rangCorps % 2 === 1;
    if (!l.total) rangCorps += 1;
    const role: RoleLigne = l.total
      ? l.numero === derniereTotal
        ? 'total-double'
        : 'total'
      : bande
        ? 'bande'
        : 'corps';
    for (let c = 1; c <= nbCols; c += 1) {
      const format = formats[c - 1];
      const valeurCellule = l.valeurs[c - 1];
      const niveau =
        colonneSeuils[c - 1] && typeof valeurCellule === 'number' && Number.isFinite(valeurCellule)
          ? niveauSeuil(valeurCellule, format)
          : null;
      appliquerStyle(ligne.getCell(c), styleCorps(role, format, numFmtPour(format, valeurCellule), niveau));
    }
  }

  // Filtre automatique et volet fige.
  feuille.autoFilter = {
    from: { row: ligneEntete, column: 1 },
    to: { row: ligneEntete, column: nbCols },
  };
  const figerPremiere = nbCols > 6 && familleDe(formats[0]) === 'dimension';
  feuille.views = [
    figerPremiere
      ? { state: 'frozen', xSplit: 1, ySplit: ligneEntete, showGridLines: false }
      : { state: 'frozen', ySplit: ligneEntete, showGridLines: false },
  ];

  // Impression.
  feuille.pageSetup = {
    ...feuille.pageSetup,
    paperSize: 9 as ExcelJS.PaperSize,
    orientation: nbCols > 6 ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 },
    printTitlesRow: `${ligneEntete}:${ligneEntete}`,
  };
  // Les & du texte libre sont doubles, les codes &P et &N restent intacts.
  const pagination = ctx.libelles.pagination('&P', '&N').replace(/&(?![PN])/g, '&&');
  const exporteLe = echapperEntetePied(ctx.libelles.exporteLe(ctx.dateExport));
  // Un titre qui commence par un chiffre se collerait a la taille de police (&12).
  const titreEntete = echapperEntetePied(ctx.titre).slice(0, 200);
  feuille.headerFooter.oddFooter = `&L${exporteLe}&R${pagination}`;
  feuille.headerFooter.oddHeader = `&C&"Calibri,Bold"&12${/^\d/.test(titreEntete) ? ' ' : ''}${titreEntete}`;
}

// ---------------------------------------------------------------------------
// Bloc de titre
// ---------------------------------------------------------------------------

function listeSousTitres(sousTitre: string | string[] | undefined): string[] {
  if (sousTitre === undefined) return [];
  return (Array.isArray(sousTitre) ? sousTitre : [sousTitre]).filter((s) => s.trim() !== '');
}

/** Nombre de lignes du bloc : titre + sous-titres + "Exporté le" + ligne vide. */
function tailleBloc(sousTitres: string[]): number {
  return 1 + sousTitres.length + 1 + 1;
}

/** Ecrit le bloc de titre a partir de `debut` (1-based), fusionne sur la largeur du tableau. */
function ecrireBlocTitre(
  feuille: ExcelJS.Worksheet,
  debut: number,
  nbCols: number,
  titre: string,
  sousTitres: string[],
  exporteLe: string
): void {
  const ecrire = (
    numero: number,
    texte: string,
    police: Partial<ExcelJS.Font>,
    hauteur?: number
  ) => {
    const ligne = feuille.getRow(numero);
    const cellule = ligne.getCell(1);
    cellule.value = texte;
    cellule.font = { name: 'Calibri', ...police };
    cellule.alignment = { horizontal: 'left', vertical: 'middle' };
    if (hauteur) ligne.height = hauteur;
    if (nbCols > 1) feuille.mergeCells(numero, 1, numero, nbCols);
  };

  ecrire(debut, titre, { size: 16, bold: true, color: { argb: BLEU_NUIT } }, 24);
  sousTitres.forEach((texte, i) => {
    ecrire(debut + 1 + i, texte, { size: 10, italic: true, color: { argb: GRIS_TEXTE } });
  });
  ecrire(debut + 1 + sousTitres.length, exporteLe, { size: 9, color: { argb: GRIS_TEXTE } });
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/** Cree une feuille presentable a partir de lignes d'objets (en-tetes = cles de la 1re ligne). */
export function construireFeuille(
  classeur: ExcelJS.Workbook,
  nomFeuille: string,
  lignes: Record<string, unknown>[],
  options: OptionsMiseEnForme = {}
): ExcelJS.Worksheet {
  const nom = nomFeuilleValide(nomFeuille);
  const titre = options.titre ?? nom;
  const libelles: LibellesExport = { ...LIBELLES_DEFAUT, ...options.libelles };
  const dateExport = options.dateExport ?? new Date();
  const sousTitres = listeSousTitres(options.sousTitre);

  classeur.creator = 'Data Genius';
  classeur.title = titre;

  const feuille = classeur.addWorksheet(nom);
  const entetes = lignes.length > 0 ? Object.keys(lignes[0]) : [];
  const nbCols = Math.max(entetes.length, 1);

  ecrireBlocTitre(feuille, 1, nbCols, titre, sousTitres, libelles.exporteLe(dateExport));
  const ligneEntete = tailleBloc(sousTitres) + 1;
  if (entetes.length === 0) return feuille;

  entetes.forEach((entete, i) => {
    feuille.getRow(ligneEntete).getCell(i + 1).value = entete;
  });
  lignes.forEach((ligne, r) => {
    const rangee = feuille.getRow(ligneEntete + 1 + r);
    entetes.forEach((entete, i) => {
      const valeur = valeurPourCellule(ligne[entete]);
      if (valeur !== null) rangee.getCell(i + 1).value = valeur;
    });
  });

  mettreEnForme(feuille, { ligneEntete, titre, options, libelles, dateExport });
  return feuille;
}

/** Met en forme sur place une feuille deja remplie dont l'en-tete est a `ligneEntete`. */
export function presenterFeuille(feuille: ExcelJS.Worksheet, options: OptionsPresenter): void {
  const libelles: LibellesExport = { ...LIBELLES_DEFAUT, ...options.libelles };
  const dateExport = options.dateExport ?? new Date();
  const titre = options.titre ?? feuille.name;
  let ligneEntete = options.ligneEntete;

  if (options.insererTitre) {
    const sousTitres = listeSousTitres(options.sousTitre);
    const taille = tailleBloc(sousTitres);
    const nbCols = Math.max(feuille.getRow(ligneEntete).cellCount, 1);
    // Lignes vides inserees au-dessus de l'en-tete ; les fusions existantes ne suivent pas.
    feuille.spliceRows(ligneEntete, 0, ...Array.from({ length: taille }, () => [] as unknown[]));
    ecrireBlocTitre(feuille, ligneEntete, nbCols, titre, sousTitres, libelles.exporteLe(dateExport));
    ligneEntete += taille;
  }

  mettreEnForme(feuille, { ligneEntete, titre, options, libelles, dateExport });
}

/**
 * ExcelJS memorise l'identifiant de style par objet (WeakMap). Avec un objet par cellule, il
 * resérialise police, bordure et fond pour chacune. Le temps de l'ecriture, les cellules de style
 * identique recoivent donc le meme objet canonique ; la fonction renvoyee remet les objets
 * d'origine (modifiables, non partages) pour qu'une retouche ou une seconde ecriture restent sures.
 */
function dedupliquerStyles(classeur: ExcelJS.Workbook): () => void {
  const originaux: [ExcelJS.Cell, Partial<ExcelJS.Style>][] = [];
  const canoniques = new Map<string, Partial<ExcelJS.Style>>();
  classeur.eachSheet((feuille) => {
    feuille.eachRow({ includeEmpty: true }, (ligne) => {
      ligne.eachCell({ includeEmpty: true }, (cellule) => {
        const style = cellule.style as Partial<ExcelJS.Style> | undefined;
        if (!style) return;
        // Cle non triee : deux ordres de proprietes donnent deux objets canoniques, jamais un style faux.
        // Sans numFmt, l'identifiant de style d'ExcelJS depend du type de la cellule (nombre : General,
        // date : mm-dd-yy, texte : aucun) : le type entre alors dans la cle.
        const cle = style.numFmt ? JSON.stringify(style) : `${cellule.type}|${JSON.stringify(style)}`;
        const canonique = canoniques.get(cle);
        originaux.push([cellule, style]);
        if (canonique === undefined) canoniques.set(cle, style);
        else if (canonique !== style) cellule.style = canonique;
      });
    });
  });
  return () => {
    for (const [cellule, style] of originaux) cellule.style = style;
  };
}

/** Ecrit le classeur et applique le correctif Excel 2007 ; utilisable dans le navigateur. */
export async function classeurEnOctets(classeur: ExcelJS.Workbook): Promise<Uint8Array> {
  const restaurer = dedupliquerStyles(classeur);
  let brut;
  try {
    brut = await classeur.xlsx.writeBuffer();
  } finally {
    restaurer();
  }
  return compatibiliserExcel2007Octets(brut as unknown as ArrayBuffer | Uint8Array);
}

/** Variante serveur : meme contenu dans un Buffer Node. */
export async function classeurEnBuffer(classeur: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await classeurEnOctets(classeur));
}

