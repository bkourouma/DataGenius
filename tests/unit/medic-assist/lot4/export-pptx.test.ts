/**
 * Export PowerPoint : la traduction des graphiques en graphiques natifs, puis le fichier réel
 * généré par pptxgenjs (preuves d'ouverture : export-ouverture.test.ts).
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import type { GraphiqueSpec } from '@/lib/medic-assist/contrats';
import {
  codeFormatNatif,
  construirePptx,
  extraireCartesien,
  graphiqueNatif,
  texteSur,
} from '@/lib/medic-assist/artefacts/exports/pptx';
import type { BlocExport } from '@/lib/medic-assist/artefacts/exports/types';
import { construireOptionGraphique } from '@/lib/medic-assist/artefacts/graphique-option';
import type { ContexteGraphique, JeuClient } from '@/lib/medic-assist/artefacts/types-rendu';

import { preparerEnvironnementServeur } from './_export-serveur';
import { blocTableau, creerPrep, modeleSimple, PROVENANCE, SQL_SECRET } from './_export-fixtures';

const jeu: JeuClient = {
  jeuDeDonneesId: 'ventes',
  colonnes: [
    { cle: 'pays', libelle: 'Pays', type: 'texte' },
    { cle: 'ca', libelle: 'CA', type: 'montant' },
    { cle: 'taux', libelle: 'Réalisation', type: 'pourcentage' },
    { cle: 'qte', libelle: 'Quantité', type: 'entier' },
    { cle: 'canal', libelle: 'Canal', type: 'texte' },
  ],
  lignes: [
    { pays: 'Mali', ca: 100, taux: 80, qte: 10, canal: 'Grossiste' },
    { pays: 'Togo', ca: 250, taux: 95.5, qte: 30, canal: 'Grossiste' },
    { pays: 'Bénin', ca: 75, taux: 60, qte: 5, canal: 'Hôpital' },
  ],
  nbLignes: 3,
  tronque: false,
  provenance: PROVENANCE,
};

preparerEnvironnementServeur();

function bloc(spec: GraphiqueSpec): Extract<BlocExport, { type: 'graphique' }> {
  return { type: 'graphique', titre: 'CA par pays', spec, jeu, modele: modeleSimple(false) };
}

function contexte(rtl = false): ContexteGraphique {
  return { locale: 'fr', theme: 'clair', rtl, traduire: cle => cle, statique: true };
}

function natif(spec: GraphiqueSpec, rtl = false) {
  const b = bloc(spec);
  const resultat = construireOptionGraphique(spec, jeu, contexte(rtl));
  return graphiqueNatif({ rtl, lang: 'fr-FR' }, b, resultat);
}

describe('utilitaires PPTX', () => {
  it('donne les formats de nombre natifs de la charte', () => {
    expect(codeFormatNatif('montant')).toBe('#,##0 "€"');
    expect(codeFormatNatif('montant_compact')).toBe('#,##0 "€"');
    expect(codeFormatNatif('pourcentage')).toBe('0.0" %"');
    expect(codeFormatNatif('entier')).toBe('#,##0');
    expect(codeFormatNatif('decimal')).toBe('#,##0.00');
    expect(codeFormatNatif('texte')).toBe('General');
    expect(codeFormatNatif(undefined)).toBe('General');
  });

  it('retire les caractères interdits en XML', () => {
    expect(texteSur('a\u0000b\u0008c\r\nd')).toBe('abc\nd');
    expect(texteSur(null)).toBe('');
    expect(texteSur(12.5)).toBe('12.5');
  });
});

describe('graphiques natifs PowerPoint', () => {
  it('barres : histogramme groupé, couleurs de la charte, format EUR, étiquettes', () => {
    const g = natif({ forme: 'barres', x: 'pays', y: [{ cle: 'ca' }], sens: 'desc' });
    expect(g?.type).toBe('bar');
    expect(g?.options).toMatchObject({
      barDir: 'col',
      barGrouping: 'clustered',
      valAxisLabelFormatCode: '#,##0 "€"',
      dataLabelFormatCode: '#,##0 "€"',
      showValue: true,
      showLegend: false,
      lang: 'fr-FR',
    });
    expect(g?.options.chartColors).toEqual(['0F4CA9']);
    expect(g?.donnees).toEqual([
      { name: 'CA', labels: ['Togo', 'Mali', 'Bénin'], values: [250, 100, 75] },
    ]);
  });

  it('barres empilées : groupement empilé, une série par valeur de « serie »', () => {
    const g = natif({ forme: 'barres_empilees', x: 'pays', y: [{ cle: 'ca' }], serie: 'canal' });
    expect(g?.type).toBe('bar');
    expect(g?.options).toMatchObject({
      barGrouping: 'stacked',
      barOverlapPct: 100,
      showLegend: true,
    });
    expect(g?.donnees.map(d => d.name)).toEqual(['Grossiste', 'Hôpital']);
    expect(g?.options.chartColors).toHaveLength(2);
  });

  it('barres horizontales : barres couchées, ordre inversé (PowerPoint part du bas)', () => {
    const g = natif({ forme: 'barres_horizontales', x: 'pays', y: [{ cle: 'ca' }], sens: 'desc' });
    expect(g?.options.barDir).toBe('bar');
    // À l'écran : Togo en haut ; PowerPoint dessine la première catégorie en bas.
    expect(g?.donnees[0].labels).toEqual(['Bénin', 'Mali', 'Togo']);
    expect(g?.donnees[0].values).toEqual([75, 100, 250]);
  });

  it('lignes et aires', () => {
    expect(natif({ forme: 'lignes', x: 'pays', y: [{ cle: 'ca' }] })?.type).toBe('line');
    const aires = natif({
      forme: 'aires',
      x: 'pays',
      y: [{ cle: 'ca' }],
      serie: 'canal',
      empile: true,
    });
    expect(aires?.type).toBe('area');
    expect(aires?.options.barGrouping).toBe('stacked');
  });

  it('secteurs et anneau : couleurs par part, pourcentages, légende', () => {
    const secteurs = natif({ forme: 'secteurs', x: 'pays', y: [{ cle: 'ca' }] });
    expect(secteurs?.type).toBe('pie');
    expect(secteurs?.options).toMatchObject({ showPercent: true, showLegend: true });
    expect(secteurs?.options.chartColors).toHaveLength(3);
    expect(secteurs?.donnees[0].values?.reduce((a, b) => a + b, 0)).toBe(425);
    const anneau = natif({ forme: 'anneau', x: 'pays', y: [{ cle: 'ca' }] });
    expect(anneau?.type).toBe('doughnut');
    expect(anneau?.options.holeSize).toBe(55);
  });

  it('nuage : abscisses en première série, ordonnées ensuite', () => {
    const g = natif({ forme: 'nuage', x: 'qte', y: [{ cle: 'ca' }] });
    expect(g?.type).toBe('scatter');
    expect(g?.donnees[0].values).toEqual([10, 30, 5]);
    expect(g?.donnees[1].values).toEqual([100, 250, 75]);
    expect(g?.options.valAxisLabelFormatCode).toBe('#,##0 "€"');
    expect(g?.options.catAxisLabelFormatCode).toBe('#,##0');
  });

  it('combiné : barres à gauche, ligne sur l’axe secondaire au format pourcentage', () => {
    const g = natif({
      forme: 'combine',
      x: 'pays',
      y: [
        { cle: 'ca', forme: 'barres' },
        { cle: 'taux', forme: 'lignes', axe: 'droite' },
      ],
    });
    expect(Array.isArray(g?.type)).toBe(true);
    const types = g?.type as {
      type: string;
      options: Record<string, unknown>;
      data: { name?: string }[];
    }[];
    expect(types.map(t => t.type)).toEqual(['bar', 'line']);
    expect(types[0].options.secondaryValAxis).toBeUndefined();
    expect(types[1].options).toMatchObject({ secondaryValAxis: true, secondaryCatAxis: true });
    expect(types[1].data[0].name).toBe('Réalisation');
    expect(g?.options.valAxes).toEqual([
      { valAxisLabelFormatCode: '#,##0 "€"' },
      { valAxisLabelFormatCode: '0.0" %"', valGridLine: { style: 'none' } },
    ]);
    expect(g?.options.catAxes).toHaveLength(2);
  });

  it('treemap, entonnoir, carte de chaleur et jauge : pas d’équivalent natif (image)', () => {
    expect(natif({ forme: 'treemap', x: 'pays', y: [{ cle: 'ca' }] })).toBeNull();
    expect(natif({ forme: 'entonnoir', x: 'pays', y: [{ cle: 'ca' }] })).toBeNull();
    expect(natif({ forme: 'jauge', x: 'pays', y: [{ cle: 'taux' }] })).toBeNull();
    expect(
      natif({ forme: 'carte_chaleur', x: 'pays', y: [{ cle: 'ca' }], serie: 'canal' })
    ).toBeNull();
  });

  it('RTL : catégories d’un graphique vertical de droite à gauche', () => {
    const g = natif({ forme: 'barres', x: 'pays', y: [{ cle: 'ca' }], sens: 'desc' }, true);
    expect(g?.donnees[0].labels).toEqual(['Bénin', 'Mali', 'Togo']);
  });

  it('lit catégories, séries, pile et axe secondaire de l’option ECharts', () => {
    const extrait = extraireCartesien({
      color: ['#0f4ca9', '#136572'],
      xAxis: { type: 'category', data: ['a', 'b'] },
      yAxis: [{ type: 'value' }, { type: 'value' }],
      series: [
        { name: 'S1', type: 'bar', data: [1, null], stack: 'pile-gauche' },
        { name: 'S2', type: 'line', data: [2, 'x'], yAxisIndex: 1 },
      ],
    });
    expect(extrait.categories).toEqual(['a', 'b']);
    expect(extrait.series).toEqual([
      {
        nom: 'S1',
        valeurs: [1, null],
        type: 'bar',
        empilee: true,
        droite: false,
        couleur: '0F4CA9',
      },
      {
        nom: 'S2',
        valeurs: [2, null],
        type: 'line',
        empilee: false,
        droite: true,
        couleur: '136572',
      },
    ]);
  });
});

describe('fichier PPTX (pptxgenjs)', () => {
  async function lire(buffer: Buffer) {
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    return JSZip.loadAsync(buffer);
  }

  it('produit une présentation avec graphique natif, tableau, indicateurs, texte et sources', async () => {
    const prep = await creerPrep(
      [
        { type: 'texte', markdown: '# Contexte\n\n- un\n- deux\n\n## Suite\n\nTexte **gras**.' },
        bloc({ forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] }),
        bloc({
          forme: 'combine',
          x: 'pays',
          y: [
            { cle: 'ca', forme: 'barres' },
            { cle: 'taux', forme: 'lignes', axe: 'droite' },
          ],
        }),
        bloc({ forme: 'secteurs', x: 'pays', y: [{ cle: 'ca' }] }),
        bloc({ forme: 'nuage', x: 'qte', y: [{ cle: 'ca' }] }),
        blocTableau(modeleSimple()),
        {
          type: 'indicateurs',
          titre: 'Synthèse',
          indicateurs: [
            {
              libelle: 'CA',
              valeur: 1250,
              format: 'montant',
              valeurFormatee: '1 250 €',
              objectif: { valeur: 1200, valeurFormatee: '1 200 €', taux: 104.2, statut: 'atteint' },
            },
          ],
        },
      ],
      { exportePar: 'Awa Traoré' }
    );
    const zip = await lire(await construirePptx(prep));
    const fichiers = Object.keys(zip.files);
    expect(fichiers).toContain('ppt/slides/slide1.xml');
    // Le compteur de graphiques de pptxgenjs est global au processus : chart1, chart2…
    const graphiques = fichiers.filter(f => /^ppt\/charts\/chart\d+\.xml$/.test(f));
    expect(graphiques).toHaveLength(4);
    const xmlGraphiques = await Promise.all(graphiques.map(f => zip.file(f)!.async('string')));
    // Combiné : un histogramme et une courbe sur deux axes de valeurs.
    const combine = xmlGraphiques.find(
      x => x.includes('<c:barChart>') && x.includes('<c:lineChart>')
    );
    expect(combine).toBeDefined();
    expect(combine!.match(/<c:valAx>/g)).toHaveLength(2);
    expect(combine).toContain('0.0&quot; %&quot;');
    expect(xmlGraphiques.some(x => x.includes('<c:pieChart>'))).toBe(true);
    expect(xmlGraphiques.some(x => x.includes('<c:scatterChart>'))).toBe(true);

    const xml = (
      await Promise.all(
        fichiers.filter(f => f.endsWith('.xml')).map(f => zip.file(f)!.async('string'))
      )
    ).join('\n');
    expect(xml).toContain('Chiffre d’affaires par pays');
    expect(xml).toContain('Sources et calcul');
    expect(xml).toContain('Atteint');
    expect(xml).toContain('#,##0 &quot;€&quot;');
    expect(xml).not.toContain(SQL_SECRET);
  }, 60_000);

  it('pagine un grand tableau et marque la présentation RTL en arabe', async () => {
    const prep = await creerPrep(
      [
        blocTableau({
          ...modeleSimple(false),
          lignes: Array.from({ length: 120 }, (_, i) => ({
            ...modeleSimple().lignes[0],
            pays: `Pays ${i}`,
          })),
        }),
      ],
      { locale: 'ar' }
    );
    const zip = await lire(await construirePptx({ ...prep, rtl: true }));
    const diapos = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    // Titre + au moins deux diapositives de tableau + sources.
    expect(diapos.length).toBeGreaterThanOrEqual(4);
    const presentation = await zip.file('ppt/presentation.xml')!.async('string');
    expect(presentation).toContain('rtl="1"');
  }, 60_000);

  it('insère treemap, entonnoir, carte de chaleur et jauge en image (ou leurs données)', async () => {
    const prep = await creerPrep([bloc({ forme: 'treemap', x: 'pays', y: [{ cle: 'ca' }] })]);
    const zip = await lire(await construirePptx(prep));
    const fichiers = Object.keys(zip.files);
    expect(fichiers.some(f => f.startsWith('ppt/media/') && f.endsWith('.svg'))).toBe(true);
  }, 60_000);
});
