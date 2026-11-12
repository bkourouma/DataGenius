import { describe, expect, it } from 'vitest';

import {
  enteteContentDisposition,
  nomFichierAscii,
  nomFichierExport,
} from '@/lib/medic-assist/artefacts/exports/nom-fichier';

const DATE = new Date(2026, 10, 2, 23, 59);

describe('nomFichierExport', () => {
  it('compose « titre date.ext » en gardant les accents', () => {
    expect(nomFichierExport('CA par pays', 'xlsx', DATE)).toBe('CA par pays 2026-11-02.xlsx');
    expect(nomFichierExport('Écarts d’été', 'csv', DATE)).toBe('Écarts d’été 2026-11-02.csv');
    expect(nomFichierExport('x', 'pptx', new Date(2026, 0, 5))).toBe('x 2026-01-05.pptx');
  });

  it('retire les caractères interdits sous Windows et les contrôles, normalise les espaces', () => {
    expect(nomFichierExport('  A\\B/C:D*E?F"G<H>I|J \t\n K  ', 'pdf', DATE)).toBe(
      'A B C D E F G H I J K 2026-11-02.pdf'
    );
    expect(nomFichierExport('a\u0000b‮c', 'pdf', DATE)).toBe('a b c 2026-11-02.pdf');
  });

  it('limite le titre à 100 caractères sans couper un caractère', () => {
    const nom = nomFichierExport('é'.repeat(150), 'xlsx', DATE);
    expect(nom).toBe(`${'é'.repeat(100)} 2026-11-02.xlsx`);
    const emoji = nomFichierExport('😀'.repeat(120), 'xlsx', DATE);
    expect(Array.from(emoji.replace(' 2026-11-02.xlsx', ''))).toHaveLength(100);
  });

  it('garde les titres arabe et chinois', () => {
    expect(nomFichierExport('الإيرادات حسب البلد', 'xlsx', DATE)).toBe(
      'الإيرادات حسب البلد 2026-11-02.xlsx'
    );
    expect(nomFichierExport('各国销售额', 'pdf', DATE)).toBe('各国销售额 2026-11-02.pdf');
  });

  it('utilise le repli traduit pour un titre vide ou fait de caractères interdits', () => {
    expect(nomFichierExport('', 'xlsx', DATE, 'Export Medic Assist')).toBe(
      'Export Medic Assist 2026-11-02.xlsx'
    );
    expect(nomFichierExport('  ///  ', 'csv', DATE, 'Export Medic Assist')).toBe(
      'Export Medic Assist 2026-11-02.csv'
    );
    expect(nomFichierExport('', 'csv', DATE)).toBe('Export 2026-11-02.csv');
  });

  it('protège les noms réservés de Windows et les points de fin', () => {
    expect(nomFichierExport('CON', 'xlsx', DATE)).toBe('CON_ 2026-11-02.xlsx');
    expect(nomFichierExport('nul', 'xlsx', DATE)).toBe('nul_ 2026-11-02.xlsx');
    expect(nomFichierExport('COM1', 'xlsx', DATE)).toBe('COM1_ 2026-11-02.xlsx');
    expect(nomFichierExport('Console', 'xlsx', DATE)).toBe('Console 2026-11-02.xlsx');
    expect(nomFichierExport('Rapport...', 'xlsx', DATE)).toBe('Rapport 2026-11-02.xlsx');
  });

  it('ne contient jamais d’id', () => {
    expect(nomFichierExport('Ventes', 'xlsx', DATE)).not.toMatch(/c[a-z0-9]{24}/);
  });
});

describe('en-tête Content-Disposition', () => {
  it('donne un nom ASCII sûr et un filename* encodé en UTF-8', () => {
    const en = enteteContentDisposition('Écarts d’été 2026-11-02.xlsx');
    expect(en).toBe(
      `attachment; filename="Ecarts d_ete 2026-11-02.xlsx"; filename*=UTF-8''%C3%89carts%20d%E2%80%99%C3%A9t%C3%A9%202026-11-02.xlsx`
    );
  });

  it('traite l’arabe et le chinois', () => {
    expect(nomFichierAscii('各国销售额 2026-11-02.pdf')).toBe('_ 2026-11-02.pdf');
    const en = enteteContentDisposition('各国销售额 2026-11-02.pdf');
    expect(en).toContain(`filename*=UTF-8''%E5%90%84`);
    expect(en).not.toMatch(/filename="[^"]*[^\x20-\x7e][^"]*"/);
  });

  it('échappe guillemets, apostrophes et astérisques', () => {
    const en = enteteContentDisposition(`a'b(c)*d.xlsx`);
    expect(en).toContain(`filename*=UTF-8''a%27b%28c%29%2Ad.xlsx`);
    expect(nomFichierAscii('a"b\\c%d;e.xlsx')).toBe('a_b_c_d_e.xlsx');
  });
});
