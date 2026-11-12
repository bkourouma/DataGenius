import { describe, expect, it } from 'vitest';

import { construireXlsx } from '@/lib/medic-assist/artefacts/exports/xlsx';
import type { IndicateurResolu } from '@/lib/medic-assist/artefacts/types-rendu';

import {
  blocTableau,
  creerPrep,
  lignesDeFeuille,
  lireClasseur,
  modelePivot,
  modeleSimple,
  PROVENANCE,
  SQL_SECRET,
} from './_export-fixtures';

// Titre en A1, trois lignes de contexte (A2:A4), « Exporté le » en A5, ligne vide, en-tête en 7.
const L_ENTETE = 7;

describe('construireXlsx : tableau', () => {
  it('produit un zip valide (PK) lisible par exceljs', async () => {
    const buffer = await construireXlsx(await creerPrep([blocTableau(modeleSimple())]));
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    const classeur = await lireClasseur(buffer);
    expect(classeur.worksheets.map(f => f.name)).toEqual(['CA par pays', 'Provenance']);
  });

  it('écrit titre, contexte (source, période, périmètre) et date d’export traduite', async () => {
    const classeur = await lireClasseur(
      await construireXlsx(await creerPrep([blocTableau(modeleSimple())]))
    );
    const f = classeur.getWorksheet('CA par pays')!;
    expect(f.getCell('A1').value).toBe('CA par pays');
    expect(f.getCell('A2').value).toBe('Source : Ventes par pays');
    expect(f.getCell('A3').value).toBe('Période : Avril à septembre 2026');
    expect(f.getCell('A4').value).toBe('Périmètre : Côte d’Ivoire, Sénégal');
    expect(String(f.getCell('A5').value)).toMatch(/^Exporté le .*2026/);
  });

  it('met les libellés en en-tête et garde les valeurs brutes (nombres, dates)', async () => {
    const classeur = await lireClasseur(
      await construireXlsx(await creerPrep([blocTableau(modeleSimple())]))
    );
    const f = classeur.getWorksheet('CA par pays')!;
    const entete = f.getRow(L_ENTETE);
    expect([1, 2, 3, 4, 5, 6].map(c => entete.getCell(c).value)).toEqual([
      'Pays',
      'Période',
      'Jour',
      'CA',
      'Quantité',
      'Réalisation',
    ]);
    const l1 = f.getRow(L_ENTETE + 1);
    expect(l1.getCell(1).value).toBe('Côte d’Ivoire');
    // période : texte formaté comme à l'écran (N-12)
    expect(l1.getCell(2).value).toBe('avr. 2026');
    // date : vraie date
    const jour = l1.getCell(3).value as Date;
    expect(jour).toBeInstanceOf(Date);
    expect([jour.getUTCFullYear(), jour.getUTCMonth() + 1, jour.getUTCDate()]).toEqual([
      2026, 4, 15,
    ]);
    // nombres bruts
    expect(l1.getCell(4).value).toBe(1250.5);
    expect(l1.getCell(5).value).toBe(120);
    expect(l1.getCell(6).value).toBe(85.5);
    expect(typeof l1.getCell(4).value).toBe('number');
    // négatif conservé
    expect(f.getRow(L_ENTETE + 3).getCell(4).value).toBe(-40.25);
  });

  it('applique les formats de nombre par colonne', async () => {
    const classeur = await lireClasseur(
      await construireXlsx(await creerPrep([blocTableau(modeleSimple())]))
    );
    const f = classeur.getWorksheet('CA par pays')!;
    const l1 = f.getRow(L_ENTETE + 1);
    expect(l1.getCell(3).numFmt).toBe('dd/mm/yyyy');
    expect(l1.getCell(4).numFmt).toContain('#,##0.00');
    expect(l1.getCell(5).numFmt).toContain('#,##0');
    expect(l1.getCell(5).numFmt).not.toContain('.00');
    expect(l1.getCell(6).numFmt).toContain('" %"');
    // texte : pas de format numérique
    expect(l1.getCell(2).numFmt ?? '@').not.toContain('0');
  });

  it('ajoute la ligne de totaux avec le libellé traduit en première cellule', async () => {
    const classeur = await lireClasseur(
      await construireXlsx(await creerPrep([blocTableau(modeleSimple(true))]))
    );
    const f = classeur.getWorksheet('CA par pays')!;
    const total = f.getRow(L_ENTETE + 4);
    expect(total.getCell(1).value).toBe('Total');
    expect(total.getCell(4).value).toBe(2190.25);
    expect(total.getCell(5).value).toBe(192);
    expect(total.getCell(6).value).toBeNull();
    expect(total.getCell(4).font?.bold).toBe(true);
    // une ligne de données n’est pas en gras
    expect(f.getRow(L_ENTETE + 1).getCell(4).font?.bold).toBeFalsy();
  });

  it('ne met pas de ligne de totaux si le tableau n’en a pas', async () => {
    const classeur = await lireClasseur(
      await construireXlsx(await creerPrep([blocTableau(modeleSimple(false))]))
    );
    const f = classeur.getWorksheet('CA par pays')!;
    expect(f.getRow(L_ENTETE + 4).getCell(1).value).toBeNull();
  });

  it('exporte un pivot tel qu’affiché, en-têtes aplatis par libellé', async () => {
    const classeur = await lireClasseur(
      await construireXlsx(await creerPrep([blocTableau(modelePivot(), 'Pivot pays')]))
    );
    const f = classeur.getWorksheet('Pivot pays')!;
    const entete = f.getRow(L_ENTETE);
    expect([1, 2, 3, 4].map(c => entete.getCell(c).value)).toEqual([
      'Pays',
      '2026-04 · CA',
      '2026-05 · CA',
      'Total',
    ]);
    expect(f.getRow(L_ENTETE + 1).getCell(2).value).toBe(100);
    expect(f.getRow(L_ENTETE + 2).getCell(3).value).toBe(25.5);
    expect(f.getRow(L_ENTETE + 3).getCell(1).value).toBe('Total');
    expect(f.getRow(L_ENTETE + 3).getCell(4).value).toBe(375.5);
  });

  it('garde l’ordre des colonnes quand un libellé est un entier (« 2026 »)', async () => {
    const modele = modelePivot();
    modele.colonnes = modele.colonnes.map((c, i) => ({
      ...c,
      libelle: i === 1 ? '2026' : i === 2 ? '2027' : c.libelle,
    }));
    const classeur = await lireClasseur(
      await construireXlsx(await creerPrep([blocTableau(modele, 'Annees')]))
    );
    const entete = classeur.getWorksheet('Annees')!.getRow(L_ENTETE);
    expect([1, 2, 3, 4].map(c => entete.getCell(c).value)).toEqual([
      'Pays',
      '2026',
      '2027',
      'Total',
    ]);
  });

  it('désambiguïse les libellés d’en-tête en double', async () => {
    const modele = modelePivot();
    modele.colonnes = modele.colonnes.map(c => ({
      ...c,
      libelle: c.type === 'valeur' ? 'CA' : c.libelle,
    }));
    const classeur = await lireClasseur(
      await construireXlsx(await creerPrep([blocTableau(modele, 'Doubles')]))
    );
    const entete = classeur.getWorksheet('Doubles')!.getRow(L_ENTETE);
    expect([2, 3].map(c => entete.getCell(c).value)).toEqual(['CA', 'CA (2)']);
  });
});

describe('construireXlsx : feuilles', () => {
  it('tronque à 31 caractères, retire les caractères interdits et garantit l’unicité', async () => {
    const long = 'Chiffre d’affaires détaillé par pays et par trimestre [2026]';
    const classeur = await lireClasseur(
      await construireXlsx(
        await creerPrep([
          blocTableau(modeleSimple(), long),
          blocTableau(modeleSimple(), long),
          blocTableau(modeleSimple(), 'a/b:c*d?'),
        ])
      )
    );
    const noms = classeur.worksheets.map(f => f.name);
    for (const n of noms) {
      expect(n.length).toBeLessThanOrEqual(31);
      expect(n).not.toMatch(/[[\]:*?/\\]/);
    }
    expect(new Set(noms.map(n => n.toLowerCase())).size).toBe(noms.length);
    expect(noms).toHaveLength(4);
  });

  it('coupe les noms longs sur une limite de mot, sans espace ni apostrophe finale', async () => {
    const titres = [
      'Chiffre d’affaires détaillé par pays et par trimestre',
      'Ventes de l’exercice en cours par grossiste d’Abidjan',
      'x'.repeat(5) + ' ' + 'y'.repeat(40),
    ];
    const classeur = await lireClasseur(
      await construireXlsx(await creerPrep(titres.map(t => blocTableau(modeleSimple(), t))))
    );
    const noms = classeur.worksheets.map(f => f.name);
    expect(noms[0]).toBe('Chiffre d’affaires détaillé par');
    expect(noms[1]).toBe('Ventes de l’exercice en cours');
    expect(noms[2]).toBe('xxxxx');
    for (const n of noms) {
      expect(n.length).toBeLessThanOrEqual(31);
      expect(n).not.toMatch(/[\s'’]$/);
    }
  });

  it('coupe sur un mot sans doubler un nom déjà pris (suffixe « (2) » dans les 31 caractères)', async () => {
    const long = 'Chiffre d’affaires détaillé par pays et par trimestre';
    const classeur = await lireClasseur(
      await construireXlsx(
        await creerPrep([blocTableau(modeleSimple(), long), blocTableau(modeleSimple(), long)])
      )
    );
    const noms = classeur.worksheets.map(f => f.name);
    expect(noms.slice(0, 2)).toEqual(['Chiffre d’affaires détaillé par', 'Chiffre d’affaires détaillé (2)']);
    expect(noms[1].length).toBeLessThanOrEqual(31);
  });

  it.each([
    ['ar', 'الإيرادات التفصيلية حسب البلد وحسب الفصل من السنة'],
    ['zh', '按国家和按季度划分的详细销售额按国家和按季度划分的详细销售额'],
    ['fr', 'Écarts de réalisation par grossiste et par mois de vente'],
  ] as const)(
    'limite à 31 caractères un titre long en %s, sans couper un mot',
    async (locale, titre) => {
      const classeur = await lireClasseur(
        await construireXlsx(
          await creerPrep([blocTableau(modeleSimple(), titre)], { locale, titre })
        )
      );
      const nom = classeur.worksheets[0].name;
      expect(nom.length).toBeLessThanOrEqual(31);
      expect(titre.startsWith(nom)).toBe(true);
      if (/\s/.test(titre.slice(0, 31 + 1)) && !/\s/.test(titre.charAt(nom.length))) {
        // coupé sur un mot : le caractère suivant du titre est une espace
        expect(titre.charAt(nom.length)).toMatch(/\s/);
      }
      expect(nom).not.toMatch(/\s$/);
    }
  );

  it('dédoublonne les lignes de provenance identiques', async () => {
    const autre = { ...PROVENANCE, libelleSource: 'Autre source' };
    const classeur = await lireClasseur(
      await construireXlsx(
        await creerPrep(
          [blocTableau(modeleSimple(), 'Graphique A'), blocTableau(modeleSimple(), 'Graphique B')],
          {
            provenances: [PROVENANCE, { ...PROVENANCE }, autre, PROVENANCE],
          }
        )
      )
    );
    const lignes = lignesDeFeuille(classeur.getWorksheet('Provenance')!).filter(
      l =>
        JSON.stringify(l).includes('Ventes par pays') || JSON.stringify(l).includes('Autre source')
    );
    expect(JSON.stringify(lignes).match(/Ventes par pays/g)).toHaveLength(1);
    expect(JSON.stringify(lignes).match(/Autre source/g)).toHaveLength(1);
  });

  it('ajoute une feuille Provenance sans jamais exporter de SQL', async () => {
    const buffer = await construireXlsx(await creerPrep([blocTableau(modeleSimple())]));
    const classeur = await lireClasseur(buffer);
    const f = classeur.getWorksheet('Provenance')!;
    const texte = JSON.stringify(lignesDeFeuille(f));
    expect(texte).toContain('Ventes par pays');
    expect(texte).toContain('Avril à septembre 2026');
    expect(texte).toContain('Côte d’Ivoire, Sénégal');
    expect(texte).toContain('Produit : Amoxicilline');
    expect(texte).toContain('Chiffre d’affaires au PGHT de la ligne');
    expect(texte).toContain('/rapports/ventes');
    // aucun SQL dans aucune feuille
    for (const feuille of classeur.worksheets) {
      expect(JSON.stringify(lignesDeFeuille(feuille))).not.toContain(SQL_SECRET);
      expect(JSON.stringify(lignesDeFeuille(feuille))).not.toMatch(/SELECT/i);
    }
    // et pas dans le zip brut non plus
    expect(buffer.includes(Buffer.from(SQL_SECRET))).toBe(false);
    expect(PROVENANCE.sql).toBe(SQL_SECRET);
  });

  it('mentionne la personne qui exporte, par son nom', async () => {
    const classeur = await lireClasseur(
      await construireXlsx(
        await creerPrep([blocTableau(modeleSimple())], { exportePar: 'Aïcha Diallo' })
      )
    );
    expect(JSON.stringify(lignesDeFeuille(classeur.getWorksheet('Provenance')!))).toContain(
      'Exporté par Aïcha Diallo'
    );
  });

  it('crée une feuille d’indicateurs avec nombres bruts', async () => {
    const indicateurs: IndicateurResolu[] = [
      {
        libelle: 'CA cumulé',
        valeur: 1234567.5,
        format: 'montant',
        valeurFormatee: '1 234 568 €',
        comparaison: {
          libelle: 'N-1',
          valeur: 1000000,
          valeurFormatee: '',
          variationPct: 23.5,
          sens: 'hausse',
        },
        objectif: {
          libelle: 'Budget',
          valeur: 1500000,
          valeurFormatee: '',
          taux: 82.3,
          statut: 'en_cours',
        },
      },
      { libelle: 'Sans objectif', valeur: null, format: 'montant', valeurFormatee: '' },
    ];
    const classeur = await lireClasseur(
      await construireXlsx(
        await creerPrep([{ type: 'indicateurs', titre: 'Synthèse', indicateurs }])
      )
    );
    const f = classeur.getWorksheet('Synthèse')!;
    const entete = f.getRow(L_ENTETE);
    expect(entete.getCell(1).value).toBe('Indicateur');
    expect(entete.getCell(9).value).toBe('Statut');
    const l = f.getRow(L_ENTETE + 1);
    expect(l.getCell(1).value).toBe('CA cumulé');
    expect(l.getCell(2).value).toBe(1234567.5);
    expect(l.getCell(5).value).toBe(23.5);
    expect(l.getCell(8).value).toBe(82.3);
    expect(l.getCell(9).value).toBe('En cours');
    expect(f.getRow(L_ENTETE + 2).getCell(2).value).toBeNull();
  });

  it('crée au moins une feuille pour un document sans tableau', async () => {
    const classeur = await lireClasseur(
      await construireXlsx(
        await creerPrep([{ type: 'texte', markdown: '# Note' }], { provenances: [] })
      )
    );
    expect(classeur.worksheets).toHaveLength(1);
    expect(classeur.worksheets[0].getCell('A1').value).toBe('Chiffre d’affaires par pays');
  });
});

describe('construireXlsx : langues', () => {
  it.each([
    ['ar', 'الإيرادات حسب البلد'],
    ['zh', '各国销售额'],
    ['hi', 'देश के अनुसार बिक्री'],
  ] as const)('exporte un titre en %s sans erreur', async (locale, titre) => {
    const modele = modeleSimple();
    modele.colonnes = modele.colonnes.map((c, i) => (i === 0 ? { ...c, libelle: titre } : c));
    const classeur = await lireClasseur(
      await construireXlsx(await creerPrep([blocTableau(modele, titre)], { locale, titre }))
    );
    const f = classeur.worksheets[0];
    expect(f.name).toBe(titre);
    expect(f.name.length).toBeLessThanOrEqual(31);
    expect(f.getCell('A1').value).toBe(titre);
    expect(f.getRow(L_ENTETE).getCell(1).value).toBe(titre);
    expect(f.getRow(L_ENTETE + 1).getCell(4).value).toBe(1250.5);
    if (locale === 'ar') {
      expect(f.views[0]?.rightToLeft).toBe(true);
    } else {
      expect(f.views[0]?.rightToLeft).toBeFalsy();
    }
  });

  it('reconnaît la ligne de totaux quelle que soit la langue du libellé', async () => {
    const prep = await creerPrep([blocTableau(modeleSimple())], { locale: 'zh' });
    const base = (await creerPrep([], { locale: 'zh' })).traduire;
    prep.traduire = (cle, valeurs) => (cle === 'exports.total' ? '合计' : base(cle, valeurs));
    const classeur = await lireClasseur(await construireXlsx(prep));
    const f = classeur.getWorksheet('CA par pays')!;
    const total = f.getRow(L_ENTETE + 4);
    expect(total.getCell(1).value).toBe('合计');
    expect(total.getCell(4).font?.bold).toBe(true);
  });
});
