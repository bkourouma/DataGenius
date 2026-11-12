/**
 * Export PDF : la définition du document (pure) est vérifiée en entier, puis le fichier est
 * réellement généré par pdfmake (preuves d'ouverture : export-ouverture.test.ts).
 * Voir _export-serveur.ts pour les conditions « serveur » rétablies sous jsdom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

import type { BlocExport } from '@/lib/medic-assist/artefacts/exports/types';
import type { ColonneModele, ModeleTableau } from '@/lib/medic-assist/artefacts/types-rendu';
import {
  assainirTexte,
  decouperColonnes,
  estCouvertParRoboto,
  largeursProportionnelles,
  localePdf,
} from '@/lib/medic-assist/artefacts/exports/polices';

import {
  importerSansDocument,
  preparerEnvironnementServeur,
  utiliserUint8ArrayNode,
} from './_export-serveur';
import { blocTableau, creerPrep, modeleSimple, PROVENANCE, SQL_SECRET } from './_export-fixtures';

preparerEnvironnementServeur();
utiliserUint8ArrayNode();
// Premier chargement de pdfmake sans `document` (voir _export-serveur.ts).
await importerSansDocument(() => import('pdfmake'));

const CHEMIN_SVG = '@/lib/medic-assist/artefacts/exports/svg-serveur';
const CHEMIN_PDF = '@/lib/medic-assist/artefacts/exports/pdf';

afterEach(() => {
  vi.doUnmock(CHEMIN_SVG);
  vi.resetModules();
});

async function chargerPdf() {
  return import(CHEMIN_PDF);
}

/** Parcourt tout l'arbre pdfmake et rend la liste des nœuds objets. */
function noeuds(racine: unknown): Record<string, unknown>[] {
  const sortie: Record<string, unknown>[] = [];
  const pile: unknown[] = [racine];
  while (pile.length > 0) {
    const n = pile.pop();
    if (Array.isArray(n)) pile.push(...n);
    else if (n && typeof n === 'object') {
      sortie.push(n as Record<string, unknown>);
      for (const v of Object.values(n)) if (v && typeof v === 'object') pile.push(v);
    }
  }
  return sortie;
}

/** Tout le texte de l'arbre, concaténé. */
function texteDe(racine: unknown): string {
  const morceaux: string[] = [];
  for (const n of noeuds(racine)) {
    if (typeof n.text === 'string') morceaux.push(n.text);
  }
  return morceaux.join('\n');
}

function sections(def: TDocumentDefinitions): Record<string, unknown>[] {
  return def.content as Content[] as unknown as Record<string, unknown>[];
}

function tables(racine: unknown): { body: unknown[][]; headerRows?: number; widths?: unknown[] }[] {
  return noeuds(racine)
    .filter(n => n.table && typeof n.table === 'object')
    .map(n => n.table as { body: unknown[][]; headerRows?: number; widths?: unknown[] });
}

function colonnesNumeriques(n: number): ColonneModele[] {
  return [
    { id: 'pays', libelle: 'Pays', format: 'texte', type: 'dimension', alignement: 'start' },
    ...Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      libelle: `Mois ${i + 1}`,
      format: 'montant' as const,
      type: 'valeur' as const,
      alignement: 'end' as const,
    })),
  ];
}

function modeleLarge(nbValeurs: number, nbLignes: number): ModeleTableau {
  const colonnes = colonnesNumeriques(nbValeurs);
  return {
    colonnes,
    lignes: Array.from({ length: nbLignes }, (_, r) => {
      const l: Record<string, unknown> = { pays: `Pays ${r + 1}` };
      for (let i = 0; i < nbValeurs; i++) l[`m${i}`] = (r + 1) * (i + 1) * 10.5;
      return l;
    }),
    totaux: null,
    estPivot: false,
    nbLignesSource: nbLignes,
    nbLignesFiltrees: nbLignes,
  };
}

const blocGraphique = (): BlocExport => ({
  type: 'graphique',
  titre: 'CA par pays',
  spec: { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] },
  jeu: {
    jeuDeDonneesId: 'ventes',
    colonnes: [
      { cle: 'pays', libelle: 'Pays', type: 'texte' },
      { cle: 'ca', libelle: 'CA', type: 'montant' },
    ],
    lignes: [
      { pays: 'Mali', ca: 100 },
      { pays: 'Togo', ca: 250 },
    ],
    nbLignes: 2,
    tronque: false,
    provenance: PROVENANCE,
  },
  modele: modeleSimple(false),
});

const blocIndicateurs = (): BlocExport => ({
  type: 'indicateurs',
  titre: 'Synthèse',
  indicateurs: [
    {
      libelle: 'CA',
      valeur: 1250,
      format: 'montant',
      valeurFormatee: '1 250 €',
      comparaison: {
        libelle: 'N-1',
        valeur: 1000,
        valeurFormatee: '1 000 €',
        variationPct: 25,
        sens: 'hausse',
      },
      objectif: {
        libelle: 'Budget',
        valeur: 1200,
        valeurFormatee: '1 200 €',
        taux: 104.2,
        statut: 'atteint',
      },
    },
    { libelle: 'Stock', valeur: null, format: 'entier', valeurFormatee: '' },
  ],
});

// ---------------------------------------------------------------------------
// Polices et charte (fonctions pures)
// ---------------------------------------------------------------------------

describe('polices du PDF', () => {
  it('replie zh, ar et hi sur l’anglais, garde les autres langues', () => {
    expect(localePdf('zh')).toBe('en');
    expect(localePdf('ar')).toBe('en');
    expect(localePdf('hi')).toBe('en');
    expect(localePdf('fr')).toBe('fr');
    expect(localePdf('es')).toBe('es');
    expect(localePdf('en')).toBe('en');
  });

  it('remplace les caractères absents de Roboto par « ? » et normalise les espaces', () => {
    expect(assainirTexte('1 250 €')).toBe('1 250 €');
    expect(assainirTexte('销售')).toBe('??');
    expect(assainirTexte('مبيعات')).toBe('??????');
    expect(assainirTexte('−1,5')).toBe('-1,5');
    expect(assainirTexte('a\u0000b‏c')).toBe('abc');
    expect(assainirTexte(null)).toBe('');
    expect(assainirTexte('Côte d’Ivoire · 85,5 % …')).toBe('Côte d’Ivoire · 85,5 % …');
    expect(estCouvertParRoboto(0x20ac)).toBe(true);
    expect(estCouvertParRoboto(0x4e00)).toBe(false);
  });

  it('découpe les tableaux trop larges en répétant les dimensions', () => {
    const parties = decouperColonnes(colonnesNumeriques(20), 8);
    expect(parties).toHaveLength(3);
    expect(parties[0]).toMatchObject({ premiere: 1, derniere: 7, total: 20 });
    expect(parties[2]).toMatchObject({ premiere: 15, derniere: 20, total: 20 });
    for (const p of parties) expect(p.indices[0]).toBe(0);
    expect(decouperColonnes(colonnesNumeriques(3), 8)).toHaveLength(1);
  });

  it('donne des largeurs bornées dont la somme vaut la largeur utile', () => {
    const l = largeursProportionnelles([2, 10, 100], 300, { min: 4, max: 40 });
    expect(l.reduce((a, b) => a + b, 0)).toBeCloseTo(300, 6);
    expect(l[0]).toBeCloseTo((4 / 54) * 300, 6);
    expect(l[2]).toBeCloseTo((40 / 54) * 300, 6);
  });
});

// ---------------------------------------------------------------------------
// Définition du document (sans pdfmake)
// ---------------------------------------------------------------------------

describe('définition du PDF', () => {
  it('pose les métadonnées, l’en-tête Data Genius et le pied « Exporté le … · Page x sur y »', async () => {
    const { definitionPdf } = await chargerPdf();
    const prep = await creerPrep([blocTableau(modeleSimple())], { exportePar: 'Awa Traoré' });
    const def: TDocumentDefinitions = await definitionPdf(prep);

    expect(def.info?.title).toBe('Chiffre d’affaires par pays');
    expect(def.info?.author).toBe('Data Genius');
    expect(def.info?.creationDate).toEqual(prep.exporteLe);
    expect(def.pageSize).toBe('A4');

    const entete = (def.header as (p: number, t: number, s: { width: number }) => unknown)(1, 3, {
      width: 595.28,
    });
    const texteEntete = texteDe(entete);
    expect(texteEntete).toContain('Data Genius');
    expect(texteEntete).toContain('Chiffre d’affaires par pays');

    const pied = texteDe((def.footer as (p: number, t: number) => unknown)(2, 3));
    expect(pied).toContain('Page 2 sur 3');
    expect(pied).toContain('Exporté le');
    expect(pied).toContain('Awa Traoré');
    // Date de l'export (2 nov. 2026), pas l'heure du serveur.
    expect(pied).toMatch(/2 nov\. 2026/);
  });

  it('commence par le titre et les lignes de contexte, finit par « Sources et calcul » sans SQL', async () => {
    const { definitionPdf } = await chargerPdf();
    const prep = await creerPrep([blocTableau(modeleSimple())]);
    const def: TDocumentDefinitions = await definitionPdf(prep);
    const secs = sections(def);
    expect(secs.length).toBeGreaterThanOrEqual(2);
    for (const s of secs) expect(s.section).toBeDefined();

    const debut = texteDe(secs[0]);
    expect(debut).toContain('Chiffre d’affaires par pays');
    expect(debut).toContain('Source : Ventes par pays');
    expect(debut).toContain('Période : Avril à septembre 2026');

    const fin = secs[secs.length - 1];
    const texteFin = texteDe(fin);
    expect(texteFin).toContain('Sources et calcul');
    expect(texteFin).toContain('Ventes par pays');
    expect(texteFin).toContain('Rapport des ventes (/rapports/ventes)');
    expect(texteFin).toContain('Produit : Amoxicilline');
    expect(JSON.stringify(def)).not.toContain(SQL_SECRET);
  });

  it('met en forme le tableau : en-tête répété, lignes insécables, nombres à droite, total en gras', async () => {
    const { definitionPdf } = await chargerPdf();
    const def: TDocumentDefinitions = await definitionPdf(
      await creerPrep([blocTableau(modeleSimple())])
    );
    const [table] = tables(def.content).filter(t => t.headerRows === 1);
    expect(table).toBeDefined();
    expect(table).toMatchObject({ headerRows: 1, dontBreakRows: true });
    // En-tête + 3 lignes + total.
    expect(table.body).toHaveLength(5);
    const entete = table.body[0] as Record<string, unknown>[];
    expect(entete.map(c => c.text)).toEqual([
      'Pays',
      'Période',
      'Jour',
      'CA',
      'Quantité',
      'Réalisation',
    ]);
    expect(entete[0]).toMatchObject({ bold: true, color: '#FFFFFF' });

    const ligne = table.body[1] as Record<string, unknown>[];
    expect(ligne[0]).toMatchObject({ alignment: 'left' });
    expect(ligne[2]).toMatchObject({ alignment: 'center' });
    expect(ligne[3]).toMatchObject({ alignment: 'right' });
    expect(String(ligne[3].text)).toContain('€');
    // Espace fine insécable remplacée (absente de Roboto).
    expect(String(ligne[3].text)).not.toContain(' ');

    const total = table.body[4] as Record<string, unknown>[];
    expect(total[0]).toMatchObject({ text: 'Total', bold: true });
    expect(total[3]).toMatchObject({ bold: true, alignment: 'right' });
    const largeurs = table.widths as number[];
    expect(largeurs.every(l => typeof l === 'number' && l > 0)).toBe(true);
  });

  it('passe en paysage au-delà de 7 colonnes et découpe au-delà de 16, sans dépasser la page', async () => {
    const { definitionPdf, COLONNES_MAX_PAGE } = await chargerPdf();
    const def: TDocumentDefinitions = await definitionPdf(
      await creerPrep([
        blocTableau(modeleLarge(9, 5), 'Neuf mois'),
        blocTableau(modeleLarge(30, 5), 'Trente mois'),
      ])
    );
    const secs = sections(def);
    const paysage = secs.filter(s => s.pageOrientation === 'landscape');
    expect(paysage.length).toBeGreaterThanOrEqual(1);
    const tabs = tables(paysage);
    // Neuf mois : une partie ; trente mois : plusieurs parties de 16 colonnes au plus.
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    const largeurPaysage = 841.89 - 36 - 36;
    for (const t of tabs) {
      expect((t.body[0] as unknown[]).length).toBeLessThanOrEqual(COLONNES_MAX_PAGE);
      const somme = (t.widths as number[]).reduce((a, b) => a + b, 0);
      const retraits = (t.widths as number[]).length * 8.5;
      expect(somme + retraits).toBeLessThanOrEqual(largeurPaysage);
    }
    expect(texteDe(def.content)).toMatch(/Colonnes 1 à 15 sur 30/);
  });

  it('tronque au-delà de 5 000 lignes et renvoie vers l’export Excel', async () => {
    const { definitionPdf, LIGNES_MAX_PDF } = await chargerPdf();
    const def: TDocumentDefinitions = await definitionPdf(
      await creerPrep([blocTableau(modeleLarge(2, LIGNES_MAX_PDF + 10))])
    );
    const [table] = tables(def.content).filter(t => t.headerRows === 1);
    expect(table.body).toHaveLength(LIGNES_MAX_PDF + 1);
    const texte = texteDe(def.content);
    expect(texte).toMatch(/5 000 lignes affichées sur 5 010/);
    expect(texte).toContain('export Excel');
  });

  it('ajoute un sommaire dès 3 blocs, pas en dessous', async () => {
    const { definitionPdf } = await chargerPdf();
    const avec: TDocumentDefinitions = await definitionPdf(
      await creerPrep([
        { type: 'texte', markdown: '# Contexte\n\nUn paragraphe.' },
        blocTableau(modeleSimple()),
        blocIndicateurs(),
      ])
    );
    expect(noeuds(avec.content).some(n => n.toc)).toBe(true);
    expect(texteDe(avec.content)).toContain('Sommaire');
    const sans: TDocumentDefinitions = await definitionPdf(
      await creerPrep([blocTableau(modeleSimple())])
    );
    expect(noeuds(sans.content).some(n => n.toc)).toBe(false);
  });

  it('rend le markdown : titres au sommaire, listes, gras, tableau, HTML ignoré', async () => {
    const { definitionPdf } = await chargerPdf();
    const def: TDocumentDefinitions = await definitionPdf(
      await creerPrep([
        {
          type: 'texte',
          markdown:
            '# Analyse\n\nLe CA **progresse**.\n\n- Mali\n- Togo\n  1. Lomé\n\n| Pays | CA |\n|---|--:|\n| Mali | 100 |\n\n<script>alert(1)</script>',
        },
      ])
    );
    const tous = noeuds(def.content);
    expect(tous.some(n => n.tocItem === true && texteDe(n).includes('Analyse'))).toBe(true);
    expect(tous.some(n => n.bold === true && n.text === 'progresse')).toBe(true);
    expect(tous.some(n => Array.isArray(n.ul))).toBe(true);
    expect(tous.some(n => Array.isArray(n.ol))).toBe(true);
    const md = tables(def.content).find(
      t => (t.body[0] as unknown[]).length === 2 && texteDe(t.body).includes('Mali')
    );
    expect(md).toBeDefined();
    expect(JSON.stringify(def.content)).not.toContain('alert(1)');
  });

  it('dessine les indicateurs en cartes, statut écrit à côté de sa couleur', async () => {
    const { definitionPdf } = await chargerPdf();
    const def: TDocumentDefinitions = await definitionPdf(await creerPrep([blocIndicateurs()]));
    const texte = texteDe(def.content);
    expect(texte).toContain('CA');
    expect(texte).toContain('1 250 €');
    expect(texte).toContain('N-1 : 1 000 €');
    expect(texte).toMatch(/Variation : \+25,0 % \(en hausse\)/);
    expect(texte).toContain('Budget : 1 200 €');
    expect(texte).toContain('Atteint');
    expect(texte).toContain('Non disponible');
    const statut = noeuds(def.content).find(n => n.text === 'Atteint');
    expect(statut?.color).toBe('#1F6F3A');
    expect(
      noeuds(def.content).some(
        n => Array.isArray(n.canvas) && JSON.stringify(n.canvas).includes('#1F6F3A')
      )
    ).toBe(true);
  });

  it('insère le graphique en SVG à la largeur utile', async () => {
    vi.doMock(CHEMIN_SVG, () => ({
      rendreGraphiqueSvg: async () =>
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>Côte 销</text></svg>',
      nettoyerSvg: (s: string) => s,
    }));
    const { definitionPdf } = await chargerPdf();
    const def: TDocumentDefinitions = await definitionPdf(await creerPrep([blocGraphique()]));
    const svg = noeuds(def.content).find(n => typeof n.svg === 'string');
    expect(svg).toBeDefined();
    expect(svg?.width).toBeCloseTo(595.28 - 72, 2);
    // Texte du SVG assaini (caractère absent de la police remplacé).
    expect(svg?.svg).toContain('<text>Côte ?</text>');
  });

  it('remplace un graphique impossible à dessiner par ses données, avec une note', async () => {
    vi.doMock(CHEMIN_SVG, () => ({
      rendreGraphiqueSvg: async () => {
        throw new Error('echarts absent');
      },
      nettoyerSvg: (s: string) => s,
    }));
    const { definitionPdf } = await chargerPdf();
    const def: TDocumentDefinitions = await definitionPdf(await creerPrep([blocGraphique()]));
    expect(noeuds(def.content).some(n => typeof n.svg === 'string')).toBe(false);
    expect(texteDe(def.content)).toContain("Le graphique n'a pas pu être dessiné");
    expect(tables(def.content).some(t => t.headerRows === 1)).toBe(true);
  });

  it('n’écrit pas l’arabe (absent de la police) : chrome et contexte refaits hors de l’arabe', async () => {
    const { definitionPdf } = await chargerPdf();
    const prep = await creerPrep([blocTableau(modeleSimple())], { locale: 'ar' });
    // Traducteur et lignes de contexte en arabe, comme les fournirait preparer-export.
    const arabe = {
      ...prep,
      traduire: () => 'عنوان',
      lignesContexte: ['المصدر : Ventes par pays'],
    };
    const def: TDocumentDefinitions = await definitionPdf(arabe);
    expect(def.language).toBe('en');
    const json = JSON.stringify(def);
    expect(json).not.toMatch(/[؀-ۿ]/);
    expect(json).not.toContain('???');
    expect(texteDe(sections(def)[0])).toContain('Ventes par pays');
  });
});

// ---------------------------------------------------------------------------
// Fichier réel (pdfmake installé)
// ---------------------------------------------------------------------------

describe('fichier PDF (pdfmake)', () => {
  const nbPages = (buffer: Buffer) =>
    (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;

  it('produit un PDF', async () => {
    const { construirePdf } = await chargerPdf();
    const buffer: Buffer = await construirePdf(
      await creerPrep([blocTableau(modeleSimple()), blocIndicateurs()])
    );
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(nbPages(buffer)).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('pagine un grand tableau sur plusieurs pages', async () => {
    const { construirePdf } = await chargerPdf();
    const buffer: Buffer = await construirePdf(await creerPrep([blocTableau(modeleLarge(4, 300))]));
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // 300 lignes + page de titre + sources : bien plus de 3 pages.
    expect(nbPages(buffer)).toBeGreaterThan(3);
  }, 60_000);

  it('produit un PDF avec un tableau très large et un document complet', async () => {
    const { construirePdf } = await chargerPdf();
    const buffer: Buffer = await construirePdf(
      await creerPrep([
        { type: 'texte', markdown: '# Titre\n\n- un\n- deux\n\n| a | b |\n|---|---|\n| 1 | 2 |' },
        blocTableau(modeleLarge(30, 40)),
        blocGraphique(),
        blocIndicateurs(),
      ])
    );
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  }, 60_000);
});

