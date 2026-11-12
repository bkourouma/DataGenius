/**
 * Reponse d'un artefact (service-reponse) : SQL de la provenance reserve aux administrateurs,
 * donnees des jeux paginees par le port, erreur du lot 2 isolee, artefacts cites.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stockage = vi.hoisted(() => ({ lireArtefact: vi.fn() }));
vi.mock('@/lib/medic-assist/artefacts/stockage-impl', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/artefacts/stockage-impl')>()),
  lireArtefact: stockage.lireArtefact,
}));
// Le branchement par defaut importe le lot 2 (souches) : inutile ici, on injecte des deps.
vi.mock('@/lib/medic-assist/donnees/outils', () => ({
  lireJeu: vi.fn(),
  lignesCompletesPourExport: vi.fn(),
}));

import { construireReponseArtefact } from '@/lib/medic-assist/artefacts/service-reponse';
import { ErreurArtefact } from '@/lib/medic-assist/artefacts/stockage-impl';
import type { DependancesArtefacts } from '@/lib/medic-assist/artefacts/ports';
import type { ContexteExecution } from '@/lib/medic-assist/contrats';

const LECTEUR = {
  userId: 'lecteur',
  roleName: 'ExecView',
  habilitations: null,
} as unknown as ContexteExecution;
const ADMIN = { ...LECTEUR, roleName: 'TenantAdmin' } as ContexteExecution;

const PROVENANCE = { source: 'sql', libelleSource: 'Ventes', sql: 'SELECT secret FROM mv_x' };

function dto(id: string, spec: unknown, proprietaire = 'lecteur') {
  return {
    id,
    conversationId: 'c1',
    type: (spec as { type: string }).type,
    titre: 'T',
    spec,
    version: 1,
    versions: [],
    jeux: [
      {
        jeuDeDonneesId: 'jeu1',
        colonnes: [],
        nbLignes: 1,
        tronque: false,
        provenance: PROVENANCE,
        calculeA: '2026-11-01T10:00:00.000Z',
      },
    ],
    enregistre: false,
    epingle: false,
    droits: {},
    proprietaire: { id: proprietaire, nom: 'A B' },
    creeA: '2026-11-01T10:00:00.000Z',
    majA: '2026-11-01T10:00:00.000Z',
  };
}

const TABLEAU = { type: 'tableau', titre: 'T', jeuDeDonneesId: 'jeu1' };
const DOCUMENT = {
  type: 'document',
  titre: 'D',
  blocs: [
    { type: 'artefact', artefactId: 'lie-ok' },
    { type: 'artefact', artefactId: 'lie-ko' },
  ],
};

function deps(charger?: DependancesArtefacts['chargerLignesPourAffichage']): DependancesArtefacts {
  return {
    chargerArtefact: vi.fn(),
    chargerJeuComplet: vi.fn(),
    chargerLignesPourAffichage:
      charger ?? vi.fn(async () => ({ lignes: [{ ca: 1 }], totaux: { ca: 1 } })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('SQL de la provenance', () => {
  it('retire pour un non-administrateur', async () => {
    stockage.lireArtefact.mockResolvedValue(dto('a', TABLEAU));
    const r = await construireReponseArtefact(LECTEUR, 'a', { deps: deps() });
    expect(r.jeux[0].provenance).not.toHaveProperty('sql');
    expect(JSON.stringify(r)).not.toContain('SELECT secret');
  });

  it('conserve pour un administrateur', async () => {
    stockage.lireArtefact.mockResolvedValue(dto('a', TABLEAU));
    const r = await construireReponseArtefact(ADMIN, 'a', { deps: deps() });
    expect(r.jeux[0].provenance.sql).toBe('SELECT secret FROM mv_x');
  });

  it('retire aussi dans les artefacts lies', async () => {
    stockage.lireArtefact.mockImplementation(async (_c, id) =>
      id === 'doc' ? dto('doc', DOCUMENT) : dto(id, TABLEAU)
    );
    const r = await construireReponseArtefact(LECTEUR, 'doc', { deps: deps() });
    expect(Object.keys(r.artefactsLies ?? {})).toContain('lie-ok');
    expect(JSON.stringify(r)).not.toContain('SELECT secret');
  });
});

describe('donnees des jeux', () => {
  it('lit les lignes de chaque jeu, version demandee transmise', async () => {
    stockage.lireArtefact.mockResolvedValue(dto('a', TABLEAU));
    const r = await construireReponseArtefact(LECTEUR, 'a', { version: 3, deps: deps() });
    expect(stockage.lireArtefact).toHaveBeenCalledWith(LECTEUR, 'a', { version: 3 });
    expect(r.donnees).toEqual({ jeu1: { lignes: [{ ca: 1 }], totaux: { ca: 1 } } });
  });

  it('recalcule dans le perimetre du lecteur seulement s’il n’est pas proprietaire', async () => {
    const charger = vi.fn(async () => ({ lignes: [] }));
    stockage.lireArtefact.mockResolvedValueOnce(dto('a', TABLEAU, 'proprio'));
    await construireReponseArtefact(LECTEUR, 'a', { deps: deps(charger) });
    expect(charger.mock.calls[0][2]).toEqual({
      recalculer: true,
      viaArtefact: { proprietaireId: 'proprio' },
    });

    stockage.lireArtefact.mockResolvedValueOnce(dto('a', TABLEAU, 'lecteur'));
    await construireReponseArtefact(LECTEUR, 'a', { deps: deps(charger) });
    expect(charger.mock.calls[1][2]).toEqual({ recalculer: false });
  });

  it('une erreur du lot 2 sur un jeu l’omet, la lecture continue, seul le nom est journalise', async () => {
    stockage.lireArtefact.mockResolvedValue(dto('a', TABLEAU));
    class ErreurLot2 extends Error {
      name = 'ErreurLot2';
    }
    const r = await construireReponseArtefact(LECTEUR, 'a', {
      deps: deps(async () => {
        throw new ErreurLot2('detail interne : SELECT * FROM mv_secrete');
      }),
    });
    expect(r.donnees).toEqual({});
    expect(r.id).toBe('a');
    expect(console.error).toHaveBeenCalledWith(expect.any(String), 'ErreurLot2');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('mv_secrete');
  });

  it('sans membre de chargement des lignes : donnees vide', async () => {
    stockage.lireArtefact.mockResolvedValue(dto('a', TABLEAU));
    const d = deps();
    delete d.chargerLignesPourAffichage;
    expect((await construireReponseArtefact(LECTEUR, 'a', { deps: d })).donnees).toEqual({});
  });
});

describe('artefacts lies', () => {
  it('un niveau, lus avec les memes regles ; un lie inaccessible est omis', async () => {
    stockage.lireArtefact.mockImplementation(async (_c, id) => {
      if (id === 'doc') return dto('doc', DOCUMENT);
      if (id === 'lie-ok') return dto('lie-ok', TABLEAU);
      throw new ErreurArtefact('introuvable', 'Artefact introuvable.');
    });
    const r = await construireReponseArtefact(LECTEUR, 'doc', { deps: deps() });
    expect(Object.keys(r.artefactsLies ?? {})).toEqual(['lie-ok']);
    expect(r.artefactsLies?.['lie-ok'].artefactsLies).toBeUndefined();
    expect(r.artefactsLies?.['lie-ok'].donnees.jeu1).toBeDefined();
  });

  it('pas de champ artefactsLies pour un artefact sans citation', async () => {
    stockage.lireArtefact.mockResolvedValue(dto('a', TABLEAU));
    expect(
      (await construireReponseArtefact(LECTEUR, 'a', { deps: deps() })).artefactsLies
    ).toBeUndefined();
  });

  it('l’artefact principal introuvable fait echouer la reponse', async () => {
    stockage.lireArtefact.mockRejectedValue(new ErreurArtefact('introuvable', 'x'));
    await expect(construireReponseArtefact(LECTEUR, 'a', { deps: deps() })).rejects.toBeInstanceOf(
      ErreurArtefact
    );
  });
});

