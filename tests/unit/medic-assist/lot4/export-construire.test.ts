/**
 * Orchestrateur d'export : ports injectés (doublures), moteur de tableau et indicateurs réels.
 * pdf.ts et pptx.ts appartiennent à un autre exécutant : leurs générateurs sont doublés.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ContexteExecution } from '@/lib/medic-assist/contrats';
import type { ArtefactSpec } from '@/lib/medic-assist/contrats';
import {
  construireExport,
  LIGNES_MAX_EXPORT,
} from '@/lib/medic-assist/artefacts/exports/construire-export';
import type { ExportPrepare } from '@/lib/medic-assist/artefacts/exports/types';
import {
  ErreurExport,
  type ArtefactEnregistre,
  type DependancesArtefacts,
  type JeuComplet,
} from '@/lib/medic-assist/artefacts/ports';

import { ErreurDonnees } from '@/lib/medic-assist/donnees/types';

import { lireClasseur, lignesDeFeuille, PROVENANCE, SQL_SECRET } from './_export-fixtures';

const generateurs = vi.hoisted(() => ({
  construirePdf: vi.fn(async (_prep: unknown) => Buffer.from('%PDF-doublure')),
  construirePptx: vi.fn(async (_prep: unknown) => Buffer.from('PK-doublure')),
}));
vi.mock('@/lib/medic-assist/artefacts/exports/pdf', () => ({
  construirePdf: generateurs.construirePdf,
}));
vi.mock('@/lib/medic-assist/artefacts/exports/pptx', () => ({
  construirePptx: generateurs.construirePptx,
}));

const CONTEXTE = {
  userId: 'u1',
  roleName: 'TenantAdmin',
  scope: { isGlobal: true },
  habilitations: null,
  locale: 'fr',
  maintenant: new Date(2026, 10, 2, 9, 30),
  jourLimite: 10,
} as unknown as ContexteExecution;

const JEU: JeuComplet = {
  jeuDeDonneesId: 'ventes',
  colonnes: [
    { cle: 'pays', libelle: 'Pays', type: 'texte' },
    { cle: 'ca', libelle: 'Chiffre d’affaires', type: 'montant' },
    { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
  ],
  lignes: [
    { pays: 'Mali', ca: 100.5, taux: 80 },
    { pays: 'Togo', ca: 200, taux: 95 },
    { pays: 'Bénin', ca: 50, taux: 40 },
  ],
  nbLignes: 3,
  tronque: false,
  totaux: { ca: 350.5 },
  provenance: PROVENANCE,
};

function artefact(id: string, spec: ArtefactSpec, titre = 'CA par pays'): ArtefactEnregistre {
  return {
    id,
    racineId: id,
    version: 1,
    type: spec.type,
    titre,
    spec,
    conversationId: null,
    userId: 'u1',
    creeLe: new Date(2026, 9, 1),
  };
}

const SPEC_TABLEAU: ArtefactSpec = {
  type: 'tableau',
  titre: 'CA par pays',
  jeuDeDonneesId: 'ventes',
  colonnes: [{ cle: 'pays' }, { cle: 'ca' }],
  tri: [{ cle: 'ca', sens: 'desc' }],
  totaux: true,
};

function deps(
  artefacts: Record<string, ArtefactEnregistre>,
  jeux: Record<string, JeuComplet | null> = { ventes: JEU }
): DependancesArtefacts & {
  chargerArtefact: ReturnType<typeof vi.fn>;
  chargerJeuComplet: ReturnType<typeof vi.fn>;
} {
  return {
    chargerArtefact: vi.fn(async (id: string) => artefacts[id] ?? null),
    chargerJeuComplet: vi.fn(async (id: string) => jeux[id] ?? null),
  };
}

async function code(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (e) {
    return e instanceof ErreurExport ? e.code : `autre:${String(e)}`;
  }
  return 'aucune erreur';
}

describe('construireExport : limite de débit', () => {
  it('convertit limite_debit_donnees en ErreurExport limite_debit en gardant le délai', async () => {
    const d = deps({ a1: artefact('a1', SPEC_TABLEAU) });
    const limite = new ErreurDonnees('trop de rejeux', 'limite_debit_donnees', 125_000);
    d.chargerJeuComplet.mockRejectedValue(limite);
    const erreur = await construireExport(CONTEXTE, 'a1', 'xlsx', { deps: d }).catch(e => e);
    expect(erreur).toBeInstanceOf(ErreurExport);
    expect(erreur.code).toBe('limite_debit');
    expect(erreur.reessayerDansMs).toBe(125_000);
    expect(erreur.cause).toBe(limite);
  });

  it('une autre ErreurDonnees reste un echec', async () => {
    const d = deps({ a1: artefact('a1', SPEC_TABLEAU) });
    d.chargerJeuComplet.mockRejectedValue(new ErreurDonnees('x', 'sql_erreur'));
    expect(await code(construireExport(CONTEXTE, 'a1', 'xlsx', { deps: d }))).toBe('echec');
  });
});

describe('construireExport', () => {
  it('exporte un tableau en xlsx avec nom, type MIME et contenu', async () => {
    const d = deps({ a1: artefact('a1', SPEC_TABLEAU) });
    const r = await construireExport(CONTEXTE, 'a1', 'xlsx', { deps: d, exportePar: 'Aïcha' });
    expect(r.nomFichier).toBe('CA par pays 2026-11-02.xlsx');
    expect(r.typeMime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(r.buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(d.chargerArtefact).toHaveBeenCalledWith('a1', CONTEXTE, undefined);
    expect(d.chargerJeuComplet).toHaveBeenCalledWith('ventes', CONTEXTE);

    const classeur = await lireClasseur(r.buffer);
    const f = classeur.getWorksheet('CA par pays')!;
    // en-tête (ligne 7 : titre, 3 lignes de contexte, exporté le, vide), tri décroissant, total
    expect(f.getRow(7).getCell(1).value).toBe('Pays');
    expect(f.getRow(8).getCell(1).value).toBe('Togo');
    expect(f.getRow(8).getCell(2).value).toBe(200);
    expect(f.getRow(11).getCell(1).value).toBe('Total');
    expect(f.getRow(11).getCell(2).value).toBe(350.5);
    const prov = JSON.stringify(lignesDeFeuille(classeur.getWorksheet('Provenance')!));
    expect(prov).toContain('Exporté par Aïcha');
    expect(prov).not.toContain(SQL_SECRET);
    // le bandeau de contexte vient de la provenance du jeu
    expect(f.getCell('A2').value).toBe('Source : Ventes par pays');
  });

  it('exporte le même tableau en csv', async () => {
    const d = deps({ a1: artefact('a1', SPEC_TABLEAU) });
    const r = await construireExport(CONTEXTE, 'a1', 'csv', { deps: d });
    expect(r.nomFichier).toBe('CA par pays 2026-11-02.csv');
    expect(r.typeMime).toBe('text/csv; charset=utf-8');
    expect(r.buffer.toString('utf8')).toBe(
      '﻿Pays;Chiffre d’affaires\r\nTogo;200\r\nMali;100,5\r\nBénin;50\r\nTotal;350,5\r\n'
    );
  });

  it('exporte un graphique par ses données complètes', async () => {
    const d = deps({
      g1: artefact('g1', {
        type: 'graphique',
        titre: 'Graphique CA',
        jeuDeDonneesId: 'ventes',
        graphique: { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] },
      }),
    });
    const r = await construireExport(CONTEXTE, 'g1', 'csv', { deps: d });
    expect(r.buffer.toString('utf8').split('\r\n')).toHaveLength(5);
    expect(r.buffer.toString('utf8')).toContain('Mali;100,5;80');
  });

  it('exporte des indicateurs en xlsx et en csv (une ligne par carte)', async () => {
    const spec: ArtefactSpec = {
      type: 'indicateurs',
      titre: 'Synthèse',
      cartes: [
        {
          libelle: 'CA total',
          source: { jeuDeDonneesId: 'ventes', colonne: 'ca' },
          format: 'montant',
        },
        {
          libelle: 'Premier',
          source: { jeuDeDonneesId: 'ventes', colonne: 'ca', ligne: 0 },
          format: 'montant',
        },
      ],
    };
    const d = deps({ i1: artefact('i1', spec, 'Synthèse') });
    const csv = (await construireExport(CONTEXTE, 'i1', 'csv', { deps: d })).buffer
      .toString('utf8')
      .split('\r\n');
    expect(csv[0]).toContain('Indicateur;Valeur');
    expect(csv[1]).toBe('CA total;350,5;;;;;;;');
    expect(csv[2]).toBe('Premier;100,5;;;;;;;');
    const classeur = await lireClasseur(
      (await construireExport(CONTEXTE, 'i1', 'xlsx', { deps: d })).buffer
    );
    expect(classeur.getWorksheet('Synthèse')!.getRow(8).getCell(2).value).toBe(350.5);
  });

  it('exporte un document en xlsx : une feuille par bloc, citations sur un niveau', async () => {
    const lie = artefact(
      'a2',
      { type: 'tableau', titre: 'Tableau cité', jeuDeDonneesId: 'ventes' },
      'Tableau cité'
    );
    const encore = artefact('a3', {
      type: 'tableau',
      titre: 'Trop profond',
      jeuDeDonneesId: 'ventes',
    });
    const doc = artefact(
      'doc',
      {
        type: 'document',
        titre: 'Rapport',
        blocs: [
          { type: 'texte', markdown: '# Intro' },
          { type: 'artefact', artefactId: 'a2' },
          { type: 'tableau', spec: { titre: 'Bloc tableau', jeuDeDonneesId: 'ventes' } },
          { type: 'artefact', artefactId: 'inconnu' },
        ],
      },
      'Rapport'
    );
    const d = deps({ doc, a2: lie, a3: encore });
    const r = await construireExport(CONTEXTE, 'doc', 'xlsx', { deps: d });
    const classeur = await lireClasseur(r.buffer);
    expect(classeur.worksheets.map(f => f.name)).toEqual([
      'Tableau cité',
      'Bloc tableau',
      'Provenance',
    ]);
    // un seul chargement du jeu partagé
    expect(d.chargerJeuComplet).toHaveBeenCalledTimes(1);
    // une provenance (jeu unique)
    expect(classeur.getWorksheet('Provenance')!.rowCount).toBeLessThan(10);
  });

  it('lit les jeux d’un autre propriétaire via l’artefact, ceux du lecteur normalement', async () => {
    const autre = { ...artefact('a1', SPEC_TABLEAU), userId: 'proprio' };
    const d = deps({ a1: autre });
    await construireExport(CONTEXTE, 'a1', 'csv', { deps: d });
    expect(d.chargerJeuComplet).toHaveBeenCalledWith('ventes', CONTEXTE, {
      proprietaireId: 'proprio',
    });

    const propre = deps({ a1: { ...autre, userId: CONTEXTE.userId } });
    await construireExport(CONTEXTE, 'a1', 'csv', { deps: propre });
    expect(propre.chargerJeuComplet).toHaveBeenCalledWith('ventes', CONTEXTE);
  });

  it('un artefact cité d’un autre propriétaire : viaArtefact pour son seul jeu', async () => {
    const lie = {
      ...artefact('a2', { ...SPEC_TABLEAU, jeuDeDonneesId: 'autres' } as ArtefactSpec),
      userId: 'proprio',
    };
    const doc = artefact('doc', {
      type: 'document',
      titre: 'Rapport',
      blocs: [
        { type: 'artefact', artefactId: 'a2' },
        { type: 'tableau', spec: { titre: 'Bloc', jeuDeDonneesId: 'ventes' } },
      ],
    } as ArtefactSpec);
    const d = deps({ doc, a2: lie }, { ventes: JEU, autres: JEU });
    await construireExport(CONTEXTE, 'doc', 'xlsx', { deps: d });
    expect(d.chargerJeuComplet).toHaveBeenCalledWith('ventes', CONTEXTE);
    expect(d.chargerJeuComplet).toHaveBeenCalledWith('autres', CONTEXTE, {
      proprietaireId: 'proprio',
    });
  });

  it('refuse le csv pour un document sans lire ses jeux', async () => {
    const doc = artefact('doc', { type: 'document', titre: 'Rapport', blocs: [] });
    const d = deps({ doc });
    expect(await code(construireExport(CONTEXTE, 'doc', 'csv', { deps: d }))).toBe(
      'format_non_supporte'
    );
    expect(d.chargerJeuComplet).not.toHaveBeenCalled();
  });

  it('appelle les générateurs pdf et pptx avec l’export préparé', async () => {
    const d = deps({ a1: artefact('a1', SPEC_TABLEAU) });
    const pdf = await construireExport(CONTEXTE, 'a1', 'pdf', { deps: d });
    expect(pdf.typeMime).toBe('application/pdf');
    expect(pdf.nomFichier).toBe('CA par pays 2026-11-02.pdf');
    expect(pdf.buffer.toString()).toBe('%PDF-doublure');
    const prep = generateurs.construirePdf.mock.calls[0][0] as ExportPrepare;
    expect(prep.titre).toBe('CA par pays');
    expect(prep.blocs).toHaveLength(1);
    expect(prep.provenances).toHaveLength(1);
    expect(prep.rtl).toBe(false);

    const pptx = await construireExport(CONTEXTE, 'a1', 'pptx', { deps: d });
    expect(pptx.typeMime).toContain('presentationml');
  });

  it('répond introuvable sans distinguer absence et refus d’accès', async () => {
    const d = deps({});
    expect(await code(construireExport(CONTEXTE, 'nope', 'xlsx', { deps: d }))).toBe('introuvable');
    expect(d.chargerJeuComplet).not.toHaveBeenCalled();
  });

  it('répond jeu_indisponible quand un jeu est refusé', async () => {
    const d = deps({ a1: artefact('a1', SPEC_TABLEAU) }, { ventes: null });
    expect(await code(construireExport(CONTEXTE, 'a1', 'xlsx', { deps: d }))).toBe(
      'jeu_indisponible'
    );
  });

  it('refuse plus de 100 000 lignes', async () => {
    expect(LIGNES_MAX_EXPORT).toBe(100_000);
    const d = deps({ a1: artefact('a1', SPEC_TABLEAU) }, { ventes: { ...JEU, nbLignes: 100_001 } });
    expect(await code(construireExport(CONTEXTE, 'a1', 'xlsx', { deps: d }))).toBe(
      'trop_de_lignes'
    );
    const ok = deps(
      { a1: artefact('a1', SPEC_TABLEAU) },
      { ventes: { ...JEU, nbLignes: 100_000 } }
    );
    expect(await code(construireExport(CONTEXTE, 'a1', 'xlsx', { deps: ok }))).toBe(
      'aucune erreur'
    );
  });

  it('refuse un format inconnu', async () => {
    const d = deps({ a1: artefact('a1', SPEC_TABLEAU) });
    expect(await code(construireExport(CONTEXTE, 'a1', 'zip' as never, { deps: d }))).toBe(
      'format_non_supporte'
    );
    expect(d.chargerArtefact).not.toHaveBeenCalled();
  });

  it('transforme une défaillance imprévue en echec, cause conservée', async () => {
    const d = deps({ a1: artefact('a1', SPEC_TABLEAU) });
    d.chargerJeuComplet.mockRejectedValueOnce(new Error('connexion perdue à la base'));
    try {
      await construireExport(CONTEXTE, 'a1', 'xlsx', { deps: d });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErreurExport);
      expect((e as ErreurExport).code).toBe('echec');
      expect((e as ErreurExport).message).toBe('echec');
      expect(((e as { cause?: Error }).cause as Error).message).toContain('connexion perdue');
    }
  });

  it('sert un pivot via le moteur de tableau', async () => {
    const jeu: JeuComplet = {
      ...JEU,
      colonnes: [
        { cle: 'pays', libelle: 'Pays', type: 'texte' },
        { cle: 'mois', libelle: 'Mois', type: 'periode' },
        { cle: 'ca', libelle: 'CA', type: 'montant' },
      ],
      lignes: [
        { pays: 'Mali', mois: '2026-04', ca: 10 },
        { pays: 'Mali', mois: '2026-05', ca: 20 },
        { pays: 'Togo', mois: '2026-04', ca: 5 },
      ],
      nbLignes: 3,
    };
    const d = deps(
      {
        p: artefact('p', {
          type: 'tableau',
          titre: 'Pivot',
          jeuDeDonneesId: 'ventes',
          pivot: {
            lignes: ['pays'],
            colonnes: ['mois'],
            valeurs: [{ cle: 'ca', agregat: 'somme' }],
          },
        }),
      },
      { ventes: jeu }
    );
    const r = await construireExport(CONTEXTE, 'p', 'csv', { deps: d });
    const lignes = r.buffer.toString('utf8').split('\r\n');
    expect(lignes[0]).toContain('Pays');
    expect(lignes.join('|')).toContain('Mali');
    expect(lignes.join('|')).toMatch(/Mali;10;20/);
  });

  it('transmet la version demandée à chargerArtefact (artefact principal seulement)', async () => {
    const d = deps({ a1: artefact('a1', SPEC_TABLEAU) });
    await construireExport(CONTEXTE, 'a1', 'csv', { deps: d, version: 3 });
    expect(d.chargerArtefact).toHaveBeenCalledWith('a1', CONTEXTE, 3);
  });

  it('construit le PDF en anglais pour zh, ar et hi, les autres formats en langue réelle', async () => {
    const d = deps({ a1: artefact('a1', SPEC_TABLEAU) });
    for (const locale of ['zh', 'ar', 'hi'] as const) {
      generateurs.construirePdf.mockClear();
      await construireExport({ ...CONTEXTE, locale }, 'a1', 'pdf', { deps: d });
      const prep = generateurs.construirePdf.mock.calls[0][0] as ExportPrepare;
      expect(prep.locale).toBe('en');
      expect(prep.rtl).toBe(false);
      // Traducteur anglais ; formats de nombres anglais (point décimal) dans le tableau.
      expect(prep.traduire('exports.lignesContexte.source', { valeur: 'X' })).toMatch(/^Source/);
      const bloc = prep.blocs[0];
      expect(bloc.type).toBe('tableau');
    }
    generateurs.construirePdf.mockClear();
    await construireExport({ ...CONTEXTE, locale: 'es' }, 'a1', 'pdf', { deps: d });
    expect((generateurs.construirePdf.mock.calls[0][0] as ExportPrepare).locale).toBe('es');

    generateurs.construirePptx.mockClear();
    await construireExport({ ...CONTEXTE, locale: 'ar' }, 'a1', 'pptx', { deps: d });
    const prepPptx = generateurs.construirePptx.mock.calls[0][0] as ExportPrepare;
    expect(prepPptx.locale).toBe('ar');
    expect(prepPptx.rtl).toBe(true);
    const csv = (
      await construireExport({ ...CONTEXTE, locale: 'zh' }, 'a1', 'csv', { deps: d })
    ).buffer.toString('utf8');
    expect(csv).toContain('100.5');
  });
});

