/**
 * Données de test communes aux exports du lot 4 (xlsx, csv, orchestrateur, route).
 * Tableaux construits à la main : ils ne dépendent ni du moteur de tableau ni des indicateurs.
 */
import ExcelJS from 'exceljs';

import type { Locale } from '@/i18n/config';
import type { Provenance } from '@/lib/medic-assist/contrats';
import type { BlocExport, ExportPrepare } from '@/lib/medic-assist/artefacts/exports/types';
import { creerTraducteurServeur } from '@/lib/medic-assist/artefacts/exports/traducteur-serveur';
import type { ColonneModele, ModeleTableau } from '@/lib/medic-assist/artefacts/types-rendu';

export const SQL_SECRET = 'SELECT secret FROM table_privee';

export const PROVENANCE: Provenance = {
  source: 'semantique',
  jeu: 'ventes',
  libelleSource: 'Ventes par pays',
  periode: { debut: '2026-04-01', fin: '2026-09-30', libelle: 'Avril à septembre 2026' },
  perimetre: { pays: ['CI', 'SN'], libelle: 'Côte d’Ivoire, Sénégal' },
  filtres: [{ libelle: 'Produit', valeur: 'Amoxicilline' }],
  regles: ['Chiffre d’affaires au PGHT de la ligne'],
  sql: SQL_SECRET,
  lienEcran: { href: '/rapports/ventes', libelle: 'Rapport des ventes' },
  calculeA: '2026-11-02T08:30:00.000Z',
};

export const COLONNES: ColonneModele[] = [
  { id: 'pays', libelle: 'Pays', format: 'texte', type: 'dimension', alignement: 'start' },
  { id: 'periode', libelle: 'Période', format: 'periode', type: 'dimension', alignement: 'start' },
  { id: 'jour', libelle: 'Jour', format: 'date', type: 'dimension', alignement: 'start' },
  { id: 'ca', libelle: 'CA', format: 'montant', type: 'valeur', alignement: 'end' },
  { id: 'qte', libelle: 'Quantité', format: 'entier', type: 'valeur', alignement: 'end' },
  { id: 'taux', libelle: 'Réalisation', format: 'pourcentage', type: 'valeur', alignement: 'end' },
];

export function modeleSimple(avecTotaux = true): ModeleTableau {
  return {
    colonnes: COLONNES,
    lignes: [
      {
        pays: 'Côte d’Ivoire',
        periode: '2026-04',
        jour: '2026-04-15',
        ca: 1250.5,
        qte: 120,
        taux: 85.5,
      },
      { pays: 'Sénégal', periode: '2026-05', jour: '2026-05-02', ca: 980, qte: 75, taux: 62 },
      { pays: 'Mali', periode: '2026-06', jour: '2026-06-30', ca: -40.25, qte: -3, taux: 101.2 },
    ],
    totaux: avecTotaux ? { ca: 2190.25, qte: 192 } : null,
    estPivot: false,
    nbLignesSource: 3,
    nbLignesFiltrees: 3,
  };
}

/** Pivot : en-têtes à plusieurs niveaux déjà aplatis par `libelle`. */
export function modelePivot(): ModeleTableau {
  return {
    colonnes: [
      { id: 'pays', libelle: 'Pays', format: 'texte', type: 'dimension', alignement: 'start' },
      {
        id: 'm1',
        libelle: '2026-04 · CA',
        entete: ['2026-04', 'CA'],
        format: 'montant',
        type: 'valeur',
        alignement: 'end',
      },
      {
        id: 'm2',
        libelle: '2026-05 · CA',
        entete: ['2026-05', 'CA'],
        format: 'montant',
        type: 'valeur',
        alignement: 'end',
      },
      { id: 'tot', libelle: 'Total', format: 'montant', type: 'total', alignement: 'end' },
    ],
    lignes: [
      { pays: 'Mali', m1: 100, m2: 200, tot: 300 },
      { pays: 'Togo', m1: 50, m2: 25.5, tot: 75.5 },
    ],
    totaux: { m1: 150, m2: 225.5, tot: 375.5 },
    estPivot: true,
    nbLignesSource: 4,
    nbLignesFiltrees: 4,
  };
}

export async function creerPrep(
  blocs: BlocExport[],
  options: { locale?: Locale; titre?: string; provenances?: Provenance[]; exportePar?: string } = {}
): Promise<ExportPrepare> {
  const locale = options.locale ?? 'fr';
  const { traduire, rtl } = await creerTraducteurServeur(locale);
  const provenances = options.provenances ?? [PROVENANCE];
  return {
    titre: options.titre ?? 'Chiffre d’affaires par pays',
    locale,
    rtl,
    traduire,
    blocs,
    provenances,
    lignesContexte: [
      traduire('exports.lignesContexte.source', { valeur: 'Ventes par pays' }),
      traduire('exports.lignesContexte.periode', { valeur: 'Avril à septembre 2026' }),
      traduire('exports.lignesContexte.perimetre', { valeur: 'Côte d’Ivoire, Sénégal' }),
    ],
    exporteLe: new Date(2026, 10, 2, 9, 30),
    exportePar: options.exportePar,
  };
}

export function blocTableau(modele: ModeleTableau, titre = 'CA par pays'): BlocExport {
  return { type: 'tableau', titre, sousTitre: undefined, modele };
}

export async function lireClasseur(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(buffer as unknown as ArrayBuffer);
  return classeur;
}

/** Texte de toutes les cellules d'une feuille, ligne par ligne. */
export function lignesDeFeuille(feuille: ExcelJS.Worksheet): unknown[][] {
  const lignes: unknown[][] = [];
  feuille.eachRow({ includeEmpty: false }, ligne => {
    const valeurs: unknown[] = [];
    ligne.eachCell({ includeEmpty: true }, c => valeurs.push(c.value));
    lignes.push(valeurs);
  });
  return lignes;
}
