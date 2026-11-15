/**
 * Orchestrateur : l'option `flux` rend un flux pour un gros xlsx, un buffer sinon (rapports
 * programmés, petits exports, autres formats) ; les erreurs typées sont levées avant le flux.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ArtefactSpec, ContexteExecution } from '@/lib/medic-assist/contrats';
import { construireExport } from '@/lib/medic-assist/artefacts/exports/construire-export';
import {
  ErreurExport,
  type ArtefactEnregistre,
  type DependancesArtefacts,
  type JeuComplet,
} from '@/lib/medic-assist/artefacts/ports';

import { lireClasseur, PROVENANCE } from '../lot4/_export-fixtures';

const CONTEXTE = {
  userId: 'u1',
  roleName: 'TenantAdmin',
  scope: { isGlobal: true },
  habilitations: null,
  locale: 'fr',
  maintenant: new Date(2026, 10, 2, 9, 30),
  jourLimite: 10,
} as unknown as ContexteExecution;

function jeu(nb: number): JeuComplet {
  return {
    jeuDeDonneesId: 'ventes',
    colonnes: [
      { cle: 'pays', libelle: 'Pays', type: 'texte' },
      { cle: 'ca', libelle: 'Chiffre d’affaires', type: 'montant' },
    ],
    lignes: Array.from({ length: nb }, (_, i) => ({ pays: `Pays ${i}`, ca: i * 1.5 })),
    nbLignes: nb,
    tronque: false,
    totaux: null,
    provenance: PROVENANCE,
  };
}

const SPEC: ArtefactSpec = {
  type: 'tableau',
  titre: 'CA par pays',
  jeuDeDonneesId: 'ventes',
  colonnes: [{ cle: 'pays' }, { cle: 'ca' }],
};

function deps(nb: number, jeuPresent = true): DependancesArtefacts {
  const artefact: ArtefactEnregistre = {
    id: 'a1',
    racineId: 'a1',
    version: 1,
    type: 'tableau',
    titre: 'CA par pays',
    spec: SPEC,
    conversationId: null,
    userId: 'u1',
    creeLe: new Date(2026, 9, 1),
  };
  return {
    chargerArtefact: vi.fn(async () => artefact),
    chargerJeuComplet: vi.fn(async () => (jeuPresent ? jeu(nb) : null)),
  } as unknown as DependancesArtefacts;
}

describe('construireExport avec option flux', () => {
  it('sans option flux : toujours un buffer (chemin des rapports programmés)', async () => {
    const r = await construireExport(CONTEXTE, 'a1', 'xlsx', { deps: deps(40) });
    expect(Buffer.isBuffer(r.buffer)).toBe(true);
    expect(r.nomFichier).toMatch(/\.xlsx$/);
  });

  it('au-dessus du seuil : un flux relisible, sans buffer', async () => {
    const r = await construireExport(CONTEXTE, 'a1', 'xlsx', {
      deps: deps(40),
      flux: true,
      seuilFlux: 10,
    });
    expect('flux' in r && r.flux).toBeTruthy();
    expect(r.buffer).toBeUndefined();
    expect(r.nomFichier).toMatch(/\.xlsx$/);
    expect(r.typeMime).toContain('spreadsheetml');
    const octets = Buffer.from(await new Response(r.flux as unknown as BodyInit).arrayBuffer());
    const classeur = await lireClasseur(octets);
    expect(classeur.worksheets[0].getCell('A1').value).toBe('CA par pays');
  });

  it('sous le seuil : un buffer même avec l’option flux', async () => {
    const r = await construireExport(CONTEXTE, 'a1', 'xlsx', {
      deps: deps(5),
      flux: true,
      seuilFlux: 10,
    });
    expect(Buffer.isBuffer(r.buffer)).toBe(true);
    expect(r.flux).toBeUndefined();
  });

  it('le csv reste un buffer même au-dessus du seuil', async () => {
    const r = await construireExport(CONTEXTE, 'a1', 'csv', {
      deps: deps(40),
      flux: true,
      seuilFlux: 10,
    });
    expect(Buffer.isBuffer(r.buffer)).toBe(true);
  });

  it('lève les erreurs typées avant de rendre un flux', async () => {
    const erreur = await construireExport(CONTEXTE, 'a1', 'xlsx', {
      deps: deps(40, false),
      flux: true,
      seuilFlux: 10,
    }).catch(e => e);
    expect(erreur).toBeInstanceOf(ErreurExport);
    expect(erreur.code).toBe('jeu_indisponible');
  });
});
