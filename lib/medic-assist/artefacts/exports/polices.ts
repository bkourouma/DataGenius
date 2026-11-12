/**
 * Polices et charte des exports PDF et PPTX (serveur seulement).
 *
 * PDF (pdfmake 0.3) :
 * - police : Roboto, livrée par pdfmake dans `node_modules/pdfmake/fonts/Roboto` (Regular,
 *   Medium pour le gras, Italic, MediumItalic). On donne à pdfmake des CHEMINS RÉELS, pas le
 *   système de fichiers virtuel : le rendu des SVG (svg-to-pdfkit embarqué) ouvre la police
 *   par `doc.font(chemin)`, qui lit le disque et ignore le système virtuel ;
 * - accès : aucune URL (`setUrlAccessPolicy` refuse tout, donc jamais de réseau) ; accès
 *   local limité aux quatre fichiers de police (`setLocalAccessPolicy`) ;
 * - couverture : Roboto couvre le latin (étendu, vietnamien), le grec et le cyrillique. Il
 *   ne couvre NI le chinois, NI l'arabe, NI le devanagari (hindi). Décision par défaut,
 *   prudente et réversible : pour zh, ar et hi, le texte de chrome du PDF est en anglais
 *   (`localePdf`) ; les données restent telles quelles mais passent par `assainirTexte`, qui
 *   remplace tout caractère hors couverture par « ? » : un PDF n'est jamais cassé (pas de
 *   carrés vides ni d'exception). Pour lever la limite, il faudrait embarquer des polices
 *   dédiées (ordre de grandeur : Noto Sans SC 8 à 17 Mo par graisse, Noto Naskh Arabic et
 *   Noto Sans Devanagari quelques centaines de Ko chacune) ET, pour l'arabe, un réordonnement
 *   bidirectionnel que pdfmake n'a pas (fontkit, sous pdfkit, applique les substitutions
 *   OpenType, mais le texte sortirait de gauche à droite) ; le devanagari serait à valider
 *   sur pièce (façonnage des conjointes) ;
 * - `construireExport` doit construire le traducteur et les formateurs du PDF avec
 *   `localePdf(locale)` (branchement fait par le chef de lot).
 *
 * Le fichier porte aussi la charte commune PDF/PPTX (couleurs de `lib/excel/mise-en-forme.ts`,
 * familles de colonnes, découpe des tableaux trop larges) pour que les deux formats aient
 * l'identité des exports Excel de l'application.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Locale } from '@/i18n/config';

import type { FormatColonne } from '@/lib/medic-assist/contrats';
import type { ColonneModele } from '../types-rendu';

// ---------------------------------------------------------------------------
// Langue du PDF
// ---------------------------------------------------------------------------

/** Langues dont l'écriture n'est pas couverte par la police du PDF. */
export const LOCALES_SANS_POLICE_PDF: readonly Locale[] = ['zh', 'ar', 'hi'];

/** Langue du texte de chrome du PDF : l'anglais pour zh, ar et hi, la langue demandée sinon. */
export function localePdf(locale: Locale): Locale {
  return LOCALES_SANS_POLICE_PDF.includes(locale) ? 'en' : locale;
}

// ---------------------------------------------------------------------------
// Couverture de Roboto (table cmap de Roboto-Regular de pdfmake 0.3.13, identique pour
// les quatre graisses ; relevée le 02/11/2026)
// ---------------------------------------------------------------------------

const COUVERTURE_ROBOTO: readonly [number, number][] = [
  [0x20, 0x7e],
  [0xa0, 0x17f],
  [0x18f, 0x18f],
  [0x192, 0x192],
  [0x1a0, 0x1a1],
  [0x1af, 0x1b0],
  [0x1f0, 0x1f0],
  [0x1fa, 0x1ff],
  [0x218, 0x21b],
  [0x237, 0x237],
  [0x259, 0x259],
  [0x2bc, 0x2bc],
  [0x2c6, 0x2c7],
  [0x2c9, 0x2c9],
  [0x2d8, 0x2dd],
  [0x2f3, 0x2f3],
  [0x300, 0x301],
  [0x303, 0x303],
  [0x309, 0x309],
  [0x30f, 0x30f],
  [0x323, 0x323],
  [0x384, 0x38a],
  [0x38c, 0x38c],
  [0x38e, 0x3a1],
  [0x3a3, 0x3ce],
  [0x3d1, 0x3d2],
  [0x3d6, 0x3d6],
  [0x400, 0x486],
  [0x488, 0x513],
  [0x1e00, 0x1e01],
  [0x1e3e, 0x1e3f],
  [0x1e80, 0x1e85],
  [0x1e9e, 0x1e9e],
  [0x1ea0, 0x1ef9],
  [0x1f4d, 0x1f4d],
  [0x2000, 0x200b],
  [0x2010, 0x2011],
  [0x2013, 0x2015],
  [0x2017, 0x201e],
  [0x2020, 0x2022],
  [0x2025, 0x2027],
  [0x2030, 0x2030],
  [0x2032, 0x2033],
  [0x2039, 0x203a],
  [0x203c, 0x203c],
  [0x2044, 0x2044],
  [0x2070, 0x2070],
  [0x2074, 0x208e],
  [0x20a3, 0x20a4],
  [0x20a6, 0x20ac],
  [0x20b1, 0x20b1],
  [0x20b9, 0x20ba],
  [0x20bc, 0x20bd],
  [0x20c1, 0x20c1],
  [0x2105, 0x2105],
  [0x2113, 0x2113],
  [0x2116, 0x2116],
  [0x2122, 0x2122],
  [0x2126, 0x2126],
  [0x212e, 0x212e],
  [0x215b, 0x215e],
  [0x2202, 0x2202],
  [0x2206, 0x2206],
  [0x220f, 0x220f],
  [0x2211, 0x2212],
  [0x221a, 0x221a],
  [0x221e, 0x221e],
  [0x222b, 0x222b],
  [0x2248, 0x2248],
  [0x2260, 0x2260],
  [0x2264, 0x2265],
  [0x25a0, 0x25a0],
  [0x25ca, 0x25cb],
  [0x25cf, 0x25cf],
  [0xfb01, 0xfb04],
];

/** Vrai si Roboto (pdfmake) a un glyphe pour ce point de code. */
export function estCouvertParRoboto(pointDeCode: number): boolean {
  let bas = 0;
  let haut = COUVERTURE_ROBOTO.length - 1;
  while (bas <= haut) {
    const milieu = (bas + haut) >> 1;
    const [debut, fin] = COUVERTURE_ROBOTO[milieu];
    if (pointDeCode < debut) haut = milieu - 1;
    else if (pointDeCode > fin) bas = milieu + 1;
    else return true;
  }
  return false;
}

/** Substitutions sans perte : espaces fines insécables (Intl fr) et séparateurs de ligne. */
const SUBSTITUTIONS: Record<number, string> = {
  0x202f: ' ', // espace fine insécable (milliers et « % » en français) -> insécable
  0x2028: '\n',
  0x2029: '\n',
  0x2212: '-', // couvert, mais le trait d'union se lit mieux dans les tableaux serrés
  0x09: ' ',
};

/**
 * Texte sûr pour le PDF : normalisé (NFC), espaces fines remplacées, caractères de contrôle
 * retirés (sauf saut de ligne) et tout caractère hors couverture de Roboto remplacé par « ? ».
 */
export function assainirTexte(texte: unknown): string {
  if (texte === null || texte === undefined) return '';
  const source = String(texte).normalize('NFC');
  let sortie = '';
  for (const caractere of source) {
    const cp = caractere.codePointAt(0) as number;
    const substitut = SUBSTITUTIONS[cp];
    if (substitut !== undefined) {
      sortie += substitut;
      continue;
    }
    if (cp === 0x0a) {
      sortie += '\n';
      continue;
    }
    // Contrôles C0/C1, sélecteurs de variante, marques de direction : invisibles, retirés.
    if (
      cp < 0x20 ||
      (cp >= 0x7f && cp < 0xa0) ||
      (cp >= 0xfe00 && cp <= 0xfe0f) ||
      (cp >= 0x200e && cp <= 0x200f) ||
      (cp >= 0x202a && cp <= 0x202e) ||
      (cp >= 0x2066 && cp <= 0x2069) ||
      cp === 0xfeff
    ) {
      continue;
    }
    sortie += estCouvertParRoboto(cp) ? caractere : '?';
  }
  return sortie;
}

// ---------------------------------------------------------------------------
// Fichiers de police
// ---------------------------------------------------------------------------

export const FAMILLE_POLICE_PDF = 'Roboto';

export interface FichiersPolice {
  normal: string;
  bold: string;
  italics: string;
  bolditalics: string;
}

const NOMS_FICHIERS: FichiersPolice = {
  normal: 'Roboto-Regular.ttf',
  bold: 'Roboto-Medium.ttf',
  italics: 'Roboto-Italic.ttf',
  bolditalics: 'Roboto-MediumItalic.ttf',
};

/** Variable d'environnement facultative : dossier contenant les quatre fichiers Roboto. */
export const VARIABLE_DOSSIER_POLICES = 'MEDIC_ASSIST_POLICES_PDF';

function fichiersDans(dossier: string): FichiersPolice | null {
  const f: FichiersPolice = {
    normal: resolve(join(dossier, NOMS_FICHIERS.normal)),
    bold: resolve(join(dossier, NOMS_FICHIERS.bold)),
    italics: resolve(join(dossier, NOMS_FICHIERS.italics)),
    bolditalics: resolve(join(dossier, NOMS_FICHIERS.bolditalics)),
  };
  return Object.values(f).every(chemin => existsSync(chemin)) ? f : null;
}

/**
 * Chemins absolus des quatre fichiers Roboto. Ordre de recherche : la variable
 * `MEDIC_ASSIST_POLICES_PDF`, puis `<racine>/node_modules/pdfmake/fonts/Roboto` (racine :
 * le répertoire courant du serveur ; avec `output: 'standalone'`, ces fichiers doivent être
 * inclus dans le traçage, voir le rapport du lot 4). Lève une erreur explicite sinon.
 */
export function fichiersPolicePdf(racine: string = process.cwd()): FichiersPolice {
  const candidats: string[] = [];
  const dossierEnv = process.env[VARIABLE_DOSSIER_POLICES];
  if (dossierEnv && dossierEnv.trim() !== '') candidats.push(dossierEnv.trim());
  candidats.push(join(racine, 'node_modules', 'pdfmake', 'fonts', 'Roboto'));
  for (const dossier of candidats) {
    const fichiers = fichiersDans(dossier);
    if (fichiers) return fichiers;
  }
  throw new Error(`Polices du PDF introuvables (cherchées dans : ${candidats.join(' ; ')})`);
}

function cleChemin(chemin: string): string {
  const absolu = resolve(chemin);
  return process.platform === 'win32' ? absolu.toLowerCase() : absolu;
}

/** Politique d'accès local de pdfmake : seuls les fichiers de police sont lisibles. */
export function politiqueAccesLocal(fichiers: FichiersPolice): (chemin: string) => boolean {
  const autorises = new Set(Object.values(fichiers).map(cleChemin));
  return chemin => typeof chemin === 'string' && autorises.has(cleChemin(chemin));
}

/** Politique d'accès aux URL de pdfmake : tout est refusé (aucun accès réseau). */
export function politiqueAccesUrl(): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Charte commune PDF / PPTX (constantes de lib/excel/mise-en-forme.ts)
// ---------------------------------------------------------------------------

/** Couleurs `RRGGBB` (sans dièse) des exports. */
export const CHARTE = {
  bleuNuit: '1F3864',
  bleuQuantite: '2F6BCB',
  vertMontant: '0F766E',
  ambreTaux: 'B45309',
  grisTexte: '595959',
  grisBordure: 'D9E1EA',
  bande: 'F5F8FC',
  fondTotal: 'DCE6F2',
  encre: '111B2C',
  blanc: 'FFFFFF',
  /** États d'objectif (palette des graphiques, thème clair). */
  etat: { atteint: '1F6F3A', enCours: 'E19909', aRisque: 'B82D1E' },
} as const;

export type FamilleColonne = 'dimension' | 'quantite' | 'montant' | 'taux';

/** Famille d'une colonne, comme dans les exports Excel (couleur de l'en-tête). */
export function familleDe(format: FormatColonne | undefined): FamilleColonne {
  if (format === 'entier' || format === 'decimal') return 'quantite';
  if (format === 'montant' || format === 'montant_compact') return 'montant';
  if (format === 'pourcentage') return 'taux';
  return 'dimension';
}

export function couleurEntete(format: FormatColonne | undefined): string {
  switch (familleDe(format)) {
    case 'quantite':
      return CHARTE.bleuQuantite;
    case 'montant':
      return CHARTE.vertMontant;
    case 'taux':
      return CHARTE.ambreTaux;
    default:
      return CHARTE.bleuNuit;
  }
}

export interface PartieColonnes {
  /** Indices (dans `colonnes`) des colonnes de cette partie, dimensions répétées en tête. */
  indices: number[];
  /** Rang (1 = premier) de la première et de la dernière colonne de valeur de la partie. */
  premiere: number;
  derniere: number;
  /** Nombre total de colonnes de valeur. */
  total: number;
}

/**
 * Découpe un tableau trop large en parties d'au plus `maxColonnes` colonnes : les colonnes
 * de dimension sont répétées dans chaque partie, les autres réparties dans l'ordre. Une seule
 * partie si tout tient (ou si les dimensions seules dépassent déjà la limite).
 */
export function decouperColonnes(
  colonnes: Pick<ColonneModele, 'type'>[],
  maxColonnes: number
): PartieColonnes[] {
  const dimensions: number[] = [];
  const valeurs: number[] = [];
  colonnes.forEach((c, i) => (c.type === 'dimension' ? dimensions : valeurs).push(i));
  const tous = colonnes.map((_, i) => i);
  const place = maxColonnes - dimensions.length;
  if (colonnes.length <= maxColonnes || place < 1 || valeurs.length === 0) {
    return [{ indices: tous, premiere: 1, derniere: valeurs.length, total: valeurs.length }];
  }
  const parties: PartieColonnes[] = [];
  for (let debut = 0; debut < valeurs.length; debut += place) {
    const tranche = valeurs.slice(debut, debut + place);
    parties.push({
      indices: [...dimensions, ...tranche],
      premiere: debut + 1,
      derniere: debut + tranche.length,
      total: valeurs.length,
    });
  }
  return parties;
}

/**
 * Largeurs proportionnelles au contenu (`longueurs` : nombre de caractères le plus long par
 * colonne), bornées, dont la somme vaut exactement `largeurTotale`.
 */
export function largeursProportionnelles(
  longueurs: number[],
  largeurTotale: number,
  options: { min?: number; max?: number } = {}
): number[] {
  const n = longueurs.length;
  if (n === 0) return [];
  const min = options.min ?? 4;
  const max = options.max ?? 40;
  const poids = longueurs.map(l => Math.min(max, Math.max(min, Number.isFinite(l) ? l : min)));
  const somme = poids.reduce((a, b) => a + b, 0);
  return poids.map(p => (p / somme) * largeurTotale);
}
