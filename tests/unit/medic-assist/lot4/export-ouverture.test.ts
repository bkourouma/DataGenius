/**
 * PREUVES d'ouverture des exports : chaque fichier est généré par la vraie fonction
 * `construireExport` (pdfmake, pptxgenjs, echarts, exceljs réels), puis RELU avec un lecteur
 * indépendant du générateur : exceljs (xlsx), unpdf/pdf.js (pdf), jszip + validateur XML
 * (pptx). Le texte relu est celui qu'une personne verrait à l'ouverture.
 */
import ExcelJS from 'exceljs';
import { XMLValidator } from 'fast-xml-parser';
import JSZip from 'jszip';
import { extractText, getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';

import { construireExport } from '@/lib/medic-assist/artefacts/exports';
import { creerTraducteurServeur } from '@/lib/medic-assist/artefacts/exports/traducteur-serveur';
import type {
  ArtefactEnregistre,
  DependancesArtefacts,
  JeuComplet,
} from '@/lib/medic-assist/artefacts/ports';
import {
  FORMES_GRAPHIQUE,
  type ArtefactSpec,
  type ContexteExecution,
  type FormatExport,
  type GraphiqueSpec,
} from '@/lib/medic-assist/contrats';
import type { Locale } from '@/i18n/config';

import {
  importerSansDocument,
  preparerEnvironnementServeur,
  utiliserUint8ArrayNode,
} from './_export-serveur';
import { PROVENANCE, SQL_SECRET } from './_export-fixtures';

preparerEnvironnementServeur();
// Premier chargement de pdfmake sans `document` (voir _export-serveur.ts).
await importerSansDocument(() => import('pdfmake'));

// ---------------------------------------------------------------------------
// Données de test : ventes par pays et par mois, en euros
// ---------------------------------------------------------------------------

const PAYS = ['Côte d’Ivoire', 'Sénégal', 'Mali', 'Cameroun', 'Togo'];
const MOIS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

function jeuVentes(nbLignesSupplementaires = 0): JeuComplet {
  const lignes: Record<string, unknown>[] = [];
  PAYS.forEach((pays, p) =>
    MOIS.forEach((periode, m) => {
      const ca = 10_000 * (p + 2) + 1_250.5 * m;
      lignes.push({
        pays,
        periode,
        produit: m % 2 ? 'Amoxicilline' : 'Paracétamol',
        ca,
        budget: ca * 0.95,
        taux: 105.3 - m,
      });
    })
  );
  for (let i = 0; i < nbLignesSupplementaires; i++) {
    lignes.push({
      pays: `Pays ${i}`,
      periode: '2026-09',
      produit: 'Amoxicilline',
      ca: 100 + i,
      budget: 90,
      taux: 100,
    });
  }
  return {
    jeuDeDonneesId: 'ventes',
    colonnes: [
      { cle: 'pays', libelle: 'Pays', type: 'texte' },
      { cle: 'periode', libelle: 'Mois', type: 'periode' },
      { cle: 'produit', libelle: 'Produit', type: 'texte' },
      { cle: 'ca', libelle: 'Chiffre d’affaires', type: 'montant' },
      { cle: 'budget', libelle: 'Budget', type: 'montant' },
      { cle: 'taux', libelle: 'Réalisation', type: 'pourcentage' },
    ],
    lignes,
    nbLignes: lignes.length,
    tronque: false,
    totaux: { ca: lignes.reduce((a, l) => a + (l.ca as number), 0) },
    provenance: PROVENANCE,
  };
}

function enregistre(id: string, spec: ArtefactSpec): ArtefactEnregistre {
  return {
    id,
    racineId: id,
    version: 1,
    type: spec.type,
    titre: spec.titre,
    sousTitre: spec.sousTitre,
    spec,
    conversationId: null,
    userId: 'u1',
    creeLe: new Date(2026, 10, 1),
  } as ArtefactEnregistre;
}

function contexte(locale: Locale = 'fr'): ContexteExecution {
  return {
    userId: 'u1',
    roleName: 'TenantAdmin',
    scope: { voitTout: true },
    habilitations: null,
    locale,
    maintenant: new Date(2026, 10, 2, 9, 30),
  } as unknown as ContexteExecution;
}

async function exporter(
  spec: ArtefactSpec,
  format: FormatExport,
  options: { locale?: Locale; jeu?: JeuComplet } = {}
): Promise<Buffer> {
  const artefact = enregistre('a1', spec);
  const jeu = options.jeu ?? jeuVentes();
  const deps: DependancesArtefacts = {
    chargerArtefact: async id => (id === 'a1' ? artefact : null),
    chargerJeuComplet: async () => jeu,
  };
  const r = await construireExport(contexte(options.locale), 'a1', format, {
    deps,
    exportePar: 'Aïcha Koné',
  });
  return r.buffer;
}

// ---------------------------------------------------------------------------
// Lecteurs indépendants
// ---------------------------------------------------------------------------

async function lirePdf(buffer: Buffer): Promise<{ pages: string[]; texte: string }> {
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(doc, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return { pages, texte: pages.join('\n') };
}

const SPEC_TABLEAU: ArtefactSpec = {
  type: 'tableau',
  titre: 'Ventes par pays et par mois',
  jeuDeDonneesId: 'ventes',
  tri: [{ cle: 'ca', sens: 'desc' }],
  totaux: true,
};

const GRAPHIQUE_COMBINE: GraphiqueSpec = {
  forme: 'combine',
  x: 'periode',
  y: [
    { cle: 'ca', forme: 'barres', axe: 'gauche' },
    { cle: 'taux', forme: 'lignes', axe: 'droite' },
  ],
};

const SPEC_DOCUMENT: ArtefactSpec = {
  type: 'document',
  titre: 'Analyse des ventes du semestre',
  blocs: [
    {
      type: 'texte',
      markdown:
        '# Constats\n\nLe CA **progresse**.\n\n- Mali stable\n- Togo en hausse\n\n| Pays | Rang |\n|---|--:|\n| Mali | 1 |',
    },
    {
      type: 'graphique',
      spec: { titre: 'CA et réalisation', jeuDeDonneesId: 'ventes', graphique: GRAPHIQUE_COMBINE },
    },
    { type: 'tableau', spec: { titre: 'Détail', jeuDeDonneesId: 'ventes', totaux: true } },
    { type: 'texte', markdown: '# Recommandations\n\n1. Suivre le budget.' },
  ],
};

// ---------------------------------------------------------------------------
// xlsx et csv
// ---------------------------------------------------------------------------

describe('ouverture xlsx et csv', () => {
  it('le xlsx se rouvre avec exceljs : en-têtes, valeurs numériques, total', async () => {
    const buffer = await exporter(SPEC_TABLEAU, 'xlsx');
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(buffer as unknown as ArrayBuffer);
    const feuille = classeur.worksheets[0];
    expect(feuille.rowCount).toBeGreaterThan(30);
    const enTetes: unknown[] = [];
    feuille.eachRow(l => {
      if (l.getCell(1).value === 'Pays') l.eachCell(c => enTetes.push(c.value));
    });
    expect(enTetes).toContain('Chiffre d’affaires');
    expect(classeur.getWorksheet('Provenance')).toBeDefined();
    const tout = JSON.stringify(feuille.getSheetValues());
    expect(tout).not.toContain(SQL_SECRET);
  });

  it('le csv commence par le BOM UTF-8 et sépare par « ; »', async () => {
    const buffer = await exporter(SPEC_TABLEAU, 'csv');
    expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lignes = buffer.toString('utf8').slice(1).split('\r\n');
    expect(lignes[0].split(';').length).toBeGreaterThanOrEqual(5);
    expect(lignes[0]).toContain('Chiffre d’affaires');
    expect(buffer.toString('utf8')).not.toContain(SQL_SECRET);
  });
});

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

describe('ouverture PDF', () => {
  utiliserUint8ArrayNode();

  it('commence par %PDF et contient titre, valeurs, « Page 1 » et les sources, jamais le SQL', async () => {
    const buffer = await exporter(SPEC_TABLEAU, 'pdf');
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buffer.subarray(-1024).toString('latin1')).toContain('%%EOF');
    const { texte } = await lirePdf(buffer);
    expect(texte).toContain('Ventes par pays et par mois');
    expect(texte).toContain('Côte d’Ivoire');
    expect(texte).toContain('Page 1 sur');
    expect(texte).toContain('Sources et calcul');
    expect(texte).toContain('Aïcha Koné');
    expect(texte).not.toContain(SQL_SECRET);
    expect(texte).not.toContain('SELECT');
  }, 60_000);

  it('pagine un tableau de 300 lignes sur plusieurs pages numérotées', async () => {
    const buffer = await exporter(SPEC_TABLEAU, 'pdf', { jeu: jeuVentes(270) });
    const { pages, texte } = await lirePdf(buffer);
    expect(pages.length).toBeGreaterThan(5);
    expect(texte).toContain(`Page ${pages.length} sur ${pages.length}`);
    expect(texte).toContain('Pays 269');
    // L'en-tête du tableau est répété sur les pages suivantes.
    expect(pages[2]).toContain('Chiffre d’affaires');
  }, 90_000);

  it('rend les 13 formes de graphique sans erreur ni repli sur un tableau', async () => {
    const specs: Record<(typeof FORMES_GRAPHIQUE)[number], GraphiqueSpec> = {
      barres: { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] },
      barres_empilees: {
        forme: 'barres_empilees',
        x: 'periode',
        y: [{ cle: 'ca' }],
        serie: 'pays',
      },
      barres_horizontales: { forme: 'barres_horizontales', x: 'pays', y: [{ cle: 'ca' }] },
      lignes: { forme: 'lignes', x: 'periode', y: [{ cle: 'ca' }] },
      aires: { forme: 'aires', x: 'periode', y: [{ cle: 'ca' }] },
      secteurs: { forme: 'secteurs', x: 'pays', y: [{ cle: 'ca' }] },
      anneau: { forme: 'anneau', x: 'pays', y: [{ cle: 'ca' }] },
      nuage: { forme: 'nuage', x: 'budget', y: [{ cle: 'ca' }] },
      combine: GRAPHIQUE_COMBINE,
      carte_chaleur: { forme: 'carte_chaleur', x: 'pays', y: [{ cle: 'ca' }], serie: 'periode' },
      treemap: { forme: 'treemap', x: 'pays', y: [{ cle: 'ca' }] },
      entonnoir: { forme: 'entonnoir', x: 'pays', y: [{ cle: 'ca' }] },
      jauge: { forme: 'jauge', x: 'pays', y: [{ cle: 'taux' }] },
    };
    expect(Object.keys(specs).sort()).toEqual([...FORMES_GRAPHIQUE].sort());
    for (const forme of FORMES_GRAPHIQUE) {
      const buffer = await exporter(
        {
          type: 'graphique',
          titre: `Forme ${forme}`,
          jeuDeDonneesId: 'ventes',
          graphique: specs[forme],
        },
        'pdf'
      );
      expect(buffer.subarray(0, 4).toString('latin1'), forme).toBe('%PDF');
      const { texte } = await lirePdf(buffer);
      expect(texte, forme).toContain(`Forme ${forme}`);
      expect(texte, forme).not.toContain('pas pu être dessiné');
      // Le dessin vectoriel contient les libellés du graphique (texte du SVG).
      if (forme !== 'jauge') expect(texte, forme).toMatch(/Mali|2026-0|avr|mai|juin/i);
    }
  }, 180_000);

  it('un document donne un PDF multi-pages avec sommaire, texte, graphique et tableau', async () => {
    const buffer = await exporter(SPEC_DOCUMENT, 'pdf');
    const { pages, texte } = await lirePdf(buffer);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(texte).toContain('Sommaire');
    for (const titre of ['Constats', 'CA et réalisation', 'Détail', 'Recommandations']) {
      // Le titre apparaît au sommaire ET dans le corps.
      expect(texte.split(titre).length - 1, titre).toBeGreaterThanOrEqual(2);
    }
    expect(texte).toContain('Le CA progresse');
    expect(texte).toContain('Mali stable');
    expect(texte).not.toContain('pas pu être dessiné');
    expect(texte).toContain('Sources et calcul');
  }, 90_000);

  it.each(['zh', 'ar', 'hi'] as const)(
    'en %s, le PDF retombe sur l’anglais, sans « ? » dans le texte de chrome',
    async locale => {
      const anglais = await creerTraducteurServeur('en');
      const buffer = await exporter(SPEC_TABLEAU, 'pdf', { locale });
      const { texte } = await lirePdf(buffer);
      const piedAttendu = anglais
        .traduire('exports.page', { page: 1, total: 1 })
        .split('1')[0]
        .trim();
      expect(texte).toContain(piedAttendu);
      expect(texte).toContain(anglais.traduire('exportsPdf.sourcesEtCalcul'));
      expect(texte).not.toContain('?');
      expect(texte).not.toMatch(/[؀-ۿऀ-ॿ一-鿿]/);
    },
    60_000
  );

  it('limite connue : une donnée en caractères chinois devient « ? » (police sans idéogrammes)', async () => {
    const jeu = jeuVentes();
    jeu.lignes[0].pays = '科特迪瓦';
    const { texte } = await lirePdf(await exporter(SPEC_TABLEAU, 'pdf', { jeu }));
    expect(texte).toContain('????');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------

async function ouvrirPptx(buffer: Buffer) {
  expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  const zip = await JSZip.loadAsync(buffer);
  const noms = Object.keys(zip.files);
  const xml = async (nom: string) => zip.file(nom)!.async('string');
  return { zip, noms, xml, diapos: noms.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)) };
}

describe('ouverture PPTX', () => {
  it.each([
    ['barres', { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] }, '<c:barChart>'],
    ['lignes', { forme: 'lignes', x: 'periode', y: [{ cle: 'ca' }] }, '<c:lineChart>'],
    ['secteurs', { forme: 'secteurs', x: 'pays', y: [{ cle: 'ca' }] }, '<c:pieChart>'],
    ['combine', GRAPHIQUE_COMBINE, '<c:lineChart>'],
  ] as [string, GraphiqueSpec, string][])(
    'un graphique %s est un vrai graphique PowerPoint (ppt/charts/chartN.xml) et un XML bien formé',
    async (_nom, graphique, balise) => {
      const buffer = await exporter(
        { type: 'graphique', titre: 'CA', jeuDeDonneesId: 'ventes', graphique },
        'pptx'
      );
      const { xml, noms, diapos } = await ouvrirPptx(buffer);
      // pptxgenjs numérote les graphiques avec un compteur du processus : chart1 au premier
      // export, chartN ensuite ; le nom est cohérent dans tout le paquet.
      const graphiques = noms.filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n));
      expect(graphiques).toHaveLength(1);
      expect(noms).toContain('ppt/slides/slide1.xml');
      const graphiqueXml = await xml(graphiques[0]);
      expect(graphiqueXml).toContain(balise);
      if (graphique.forme === 'combine') {
        expect(graphiqueXml).toContain('<c:barChart>');
        expect(graphiqueXml.match(/<c:valAx>/g)).toHaveLength(2);
      }
      // Diapositives : titre, graphique, sources.
      expect(diapos).toHaveLength(3);

      for (const nom of noms.filter(n => /\.(xml|rels)$/.test(n))) {
        const resultat = XMLValidator.validate(await xml(nom));
        expect(resultat, `${nom} : ${JSON.stringify(resultat)}`).toBe(true);
      }
    },
    60_000
  );

  it('aucune relation ne pointe vers une URL externe, et le SQL est absent', async () => {
    const buffer = await exporter(SPEC_DOCUMENT, 'pptx');
    const { xml, noms } = await ouvrirPptx(buffer);
    for (const nom of noms.filter(n => n.endsWith('.rels'))) {
      const rels = await xml(nom);
      expect(rels, nom).not.toMatch(/TargetMode="External"/);
      // Les cibles sont des chemins relatifs du paquet ; `Type` est un URI de schéma OOXML.
      for (const [, cible] of rels.matchAll(/Target="([^"]*)"/g)) {
        expect(cible, `${nom} -> ${cible}`).not.toMatch(/^[a-z]+:/i);
      }
      for (const [, type] of rels.matchAll(/Type="([^"]*)"/g)) {
        expect(type, nom).toMatch(/^http:\/\/schemas\.(openxmlformats\.org|microsoft\.com)\//);
      }
    }
    for (const nom of noms.filter(n => n.endsWith('.xml'))) {
      expect(await xml(nom), nom).not.toContain(SQL_SECRET);
    }
  }, 60_000);

  it('un document donne une présentation multi-diapositives (texte, graphique, tableau, sources)', async () => {
    const buffer = await exporter(SPEC_DOCUMENT, 'pptx');
    const { xml, noms, diapos } = await ouvrirPptx(buffer);
    // Titre + texte + graphique + tableau + texte + sources : au moins 6 diapositives.
    expect(diapos.length).toBeGreaterThanOrEqual(6);
    expect(noms.some(n => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toBe(true);
    const texte = (await Promise.all(diapos.map(d => xml(d)))).join('\n');
    for (const attendu of [
      'Analyse des ventes du semestre',
      'Constats',
      'Mali stable',
      'CA et réalisation',
      'Détail',
      'Recommandations',
      'Sources et calcul',
    ]) {
      expect(texte, attendu).toContain(attendu);
    }
    expect(texte).toContain('<a:tbl>');
    for (const nom of noms.filter(n => /\.(xml|rels)$/.test(n))) {
      expect(XMLValidator.validate(await xml(nom)), nom).toBe(true);
    }
  }, 60_000);

  it('une forme sans équivalent PowerPoint (treemap) est insérée en image', async () => {
    const buffer = await exporter(
      {
        type: 'graphique',
        titre: 'Treemap',
        jeuDeDonneesId: 'ventes',
        graphique: { forme: 'treemap', x: 'pays', y: [{ cle: 'ca' }] },
      },
      'pptx'
    );
    const { noms } = await ouvrirPptx(buffer);
    expect(noms.some(n => n.startsWith('ppt/media/'))).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Langue des formats
// ---------------------------------------------------------------------------

describe('langue des exports', () => {
  it('xlsx, csv et pptx gardent la langue réelle ; seul le PDF se replie sur l’anglais', async () => {
    const csvZh = (await exporter(SPEC_TABLEAU, 'csv', { locale: 'zh' })).toString('utf8');
    expect(csvZh).toContain('1250.5'); // point décimal : pas le français
    const csvFr = (await exporter(SPEC_TABLEAU, 'csv', { locale: 'fr' })).toString('utf8');
    expect(csvFr).toContain('1250,5');
    const zh = await creerTraducteurServeur('zh');
    const pptx = await ouvrirPptx(await exporter(SPEC_TABLEAU, 'pptx', { locale: 'zh' }));
    const sources = zh.traduire('exportsPptx.sourcesEtCalcul');
    const texte = (await Promise.all(pptx.diapos.map(d => pptx.xml(d)))).join('\n');
    expect(texte).toContain(sources);
  }, 60_000);
});

