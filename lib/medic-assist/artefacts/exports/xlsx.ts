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

import ExcelJS from 'exceljs';

import {
  classeurEnBuffer,
  construireFeuille,
  nomFeuilleValide,
  type FormatColonne as FormatExcel,
  type LibellesExport,
  type OptionsColonne,
} from '@/lib/excel/mise-en-forme';
import { toIntlTag } from '@/i18n/config';

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
): void {
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

/** Construit le classeur et le rend en Buffer. */
export async function construireXlsx(prep: ExportPrepare): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  classeur.created = prep.exporteLe;
  const pris = new Set<string>();
  const libelles: Partial<LibellesExport> = {
    exporteLe: date =>
      prep.traduire('exports.exporteLe', { date: formaterDateHeure(date, prep.locale) }),
    pagination: (page, total) => prep.traduire('exports.page', { page, total }),
  };
  const donnees = prep.traduire('exports.feuilleDonnees');

  for (const bloc of prep.blocs) {
    if (bloc.type === 'texte') continue;
    if (bloc.type === 'indicateurs') {
      const nom = nomFeuilleUnique(bloc.titre || prep.traduire('exports.feuilleIndicateurs'), pris);
      ajouterFeuille(
        classeur,
        prep,
        libelles,
        decrireIndicateurs(prep, nom, bloc.titre || prep.titre, bloc.sousTitre, bloc.indicateurs)
      );
    } else {
      const nom = nomFeuilleUnique(bloc.titre || donnees, pris);
      ajouterFeuille(
        classeur,
        prep,
        libelles,
        decrireTableau(prep, nom, bloc.titre || prep.titre, bloc.sousTitre, bloc.modele)
      );
    }
  }

  if (classeur.worksheets.length === 0) {
    ajouterFeuille(classeur, prep, libelles, {
      nom: nomFeuilleUnique(donnees, pris),
      titre: prep.titre,
      sousTitres: ligneContexte(prep, prep.sousTitre),
      colonnes: [],
      lignes: [],
    });
  }

  if (prep.provenances.length > 0) {
    const nom = nomFeuilleUnique(prep.traduire('exports.feuilleProvenance'), pris);
    ajouterFeuille(classeur, prep, libelles, decrireProvenance(prep, nom));
  }

  return classeurEnBuffer(classeur);
}
