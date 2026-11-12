'use client';

import {
  construireFeuille,
  classeurEnOctets,
  type FormatColonne,
  type OptionsColonne,
  type LibellesExport,
} from '@/lib/excel/mise-en-forme';

export type ExportRow = Record<string, unknown>;

export type { FormatColonne, OptionsColonne, LibellesExport };

export interface ExportToExcelOptions {
  worksheetName?: string;
  /** Titre du bloc de tete ; par defaut le nom de la feuille. */
  titre?: string;
  /** Periode, filtres, perimetre : une ligne par element. */
  sousTitre?: string | string[];
  /** Format et largeur par libelle d'en-tete (sinon deduits des valeurs). */
  colonnes?: Record<string, OptionsColonne>;
  /** Textes traduits du bloc de tete et du pied de page. */
  libelles?: Partial<LibellesExport>;
  /** Reconnait les lignes de total quand leur libelle n'est pas « total... » (arabe, hindi, chinois). */
  estLigneTotal?: (cellules: unknown[]) => boolean;
}

function normalizeCellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // Date LOCALE (jour calendaire affiche), heure ajoutee seulement si non nulle.
    if (Number.isNaN(value.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    const jour = `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
    const aUneHeure = value.getHours() !== 0 || value.getMinutes() !== 0;
    return aUneHeure ? `${jour} ${p(value.getHours())}:${p(value.getMinutes())}` : jour;
  }
  if (typeof value === 'number') {
    // Cap fractional precision at 2 decimals so exports don't show
    // long floats like 15.2846741122. Integers stay integers because
    // Number((1000).toFixed(2)) === 1000.
    if (!Number.isFinite(value)) return value;
    return Number(value.toFixed(2));
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

function escapeCsvValue(value: unknown): string {
  const normalized = normalizeCellValue(value);
  const text = String(normalized ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportRowsToCsv(rows: ExportRow[], filename: string) {
  if (!rows.length) {
    throw new Error('Aucune donnée à exporter');
  }

  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(';'),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(';')),
  ];

  const blob = new Blob(['\uFEFF' + csvLines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  });

  downloadBlob(blob, filename);
}

export async function exportRowsToExcel(
  rows: ExportRow[],
  filename: string,
  options: ExportToExcelOptions = {}
) {
  if (!rows.length) {
    throw new Error('Aucune donnée à exporter');
  }

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const nomFeuille = options.worksheetName || 'Export';
  // Mise en forme (titre, couleurs, formats, impression) : voir lib/excel/mise-en-forme.ts.
  construireFeuille(workbook, nomFeuille, rows, {
    titre: options.titre ?? nomFeuille,
    sousTitre: options.sousTitre,
    colonnes: options.colonnes,
    libelles: options.libelles,
    estLigneTotal: options.estLigneTotal,
  });

  const octets = await classeurEnOctets(workbook);
  const blob = new Blob([octets as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  downloadBlob(blob, filename);
}
