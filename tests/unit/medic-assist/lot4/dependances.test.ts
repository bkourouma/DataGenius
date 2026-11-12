/**
 * Branchement par defaut : stockage-impl (artefact) et lot 2 (jeux), lot 2 en doublure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lot2 = vi.hoisted(() => ({ lireJeu: vi.fn(), lignesCompletesPourExport: vi.fn() }));
vi.mock('@/lib/medic-assist/donnees/outils', () => lot2);

const stockage = vi.hoisted(() => ({ lireArtefact: vi.fn() }));
vi.mock('@/lib/medic-assist/artefacts/stockage-impl', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/artefacts/stockage-impl')>()),
  lireArtefact: stockage.lireArtefact,
}));

import { dependancesParDefaut } from '@/lib/medic-assist/artefacts/dependances';
import { ErreurArtefact } from '@/lib/medic-assist/artefacts/stockage-impl';
import type { ContexteExecution } from '@/lib/medic-assist/contrats';

const CONTEXTE = {
  userId: 'u1',
  roleName: 'ExecView',
  habilitations: null,
} as unknown as ContexteExecution;
const SPEC = { type: 'tableau', titre: 'CA', sousTitre: 'Avril', jeuDeDonneesId: 'jeu1' };
const PROVENANCE = { source: 'sql', libelleSource: 'Ventes' };

function dto(extra = {}) {
  return {
    id: 'racine',
    conversationId: 'c1',
    type: 'tableau',
    titre: 'CA',
    spec: SPEC,
    version: 2,
    versions: [
      {
        version: 1,
        titre: 'CA',
        type: 'tableau',
        creeA: '2026-11-01T10:00:00.000Z',
        auteur: 'assistant',
      },
      {
        version: 2,
        titre: 'CA',
        type: 'tableau',
        creeA: '2026-11-02T10:00:00.000Z',
        auteur: 'utilisateur',
      },
    ],
    jeux: [],
    enregistre: false,
    epingle: false,
    droits: {},
    proprietaire: { id: 'proprio', nom: 'A B' },
    creeA: '2026-11-01T10:00:00.000Z',
    majA: '2026-11-02T10:00:00.000Z',
    ...extra,
  };
}

beforeEach(() => vi.resetAllMocks());

describe('chargerArtefact', () => {
  it('conversationId null (SetNull) reste null', async () => {
    stockage.lireArtefact.mockResolvedValue(dto({ conversationId: null }));
    expect(
      (await dependancesParDefaut.chargerArtefact('racine', CONTEXTE))?.conversationId
    ).toBeNull();
  });

  it('convertit le DTO en ArtefactEnregistre (proprietaire, date de la version lue)', async () => {
    stockage.lireArtefact.mockResolvedValue(dto());
    const a = await dependancesParDefaut.chargerArtefact('racine', CONTEXTE, 2);
    expect(stockage.lireArtefact).toHaveBeenCalledWith(CONTEXTE, 'racine', { version: 2 });
    expect(a).toEqual({
      id: 'racine',
      racineId: 'racine',
      version: 2,
      type: 'tableau',
      titre: 'CA',
      sousTitre: 'Avril',
      spec: SPEC,
      conversationId: 'c1',
      userId: 'proprio',
      creeLe: new Date('2026-11-02T10:00:00.000Z'),
    });
  });

  it('appelle lireArtefact sans option quand aucune version n’est demandee', async () => {
    stockage.lireArtefact.mockResolvedValue(dto());
    await dependancesParDefaut.chargerArtefact('racine', CONTEXTE);
    expect(stockage.lireArtefact).toHaveBeenCalledWith(CONTEXTE, 'racine', undefined);
  });

  it('renvoie null pour un artefact introuvable ou non accessible', async () => {
    stockage.lireArtefact.mockRejectedValue(new ErreurArtefact('introuvable', 'x'));
    expect(await dependancesParDefaut.chargerArtefact('x', CONTEXTE)).toBeNull();
  });

  it('laisse remonter une erreur inattendue', async () => {
    stockage.lireArtefact.mockRejectedValue(new Error('base indisponible'));
    await expect(dependancesParDefaut.chargerArtefact('x', CONTEXTE)).rejects.toThrow(
      'base indisponible'
    );
  });
});

describe('chargerJeuComplet', () => {
  it('passe par lignesCompletesPourExport du lot 2', async () => {
    lot2.lignesCompletesPourExport.mockResolvedValue({
      colonnes: [{ cle: 'ca' }],
      lignes: [{ ca: 1 }, { ca: 2 }],
      provenance: PROVENANCE,
    });
    const jeu = await dependancesParDefaut.chargerJeuComplet('jeu1', CONTEXTE);
    expect(lot2.lignesCompletesPourExport).toHaveBeenCalledWith('jeu1', CONTEXTE);
    expect(jeu).toMatchObject({ jeuDeDonneesId: 'jeu1', nbLignes: 2, tronque: false });
  });

  it('transmet viaArtefact (propriétaire de l’artefact) à lignesCompletesPourExport', async () => {
    lot2.lignesCompletesPourExport.mockResolvedValue({
      colonnes: [],
      lignes: [],
      provenance: PROVENANCE,
    });
    await dependancesParDefaut.chargerJeuComplet('jeu1', CONTEXTE, { proprietaireId: 'proprio' });
    expect(lot2.lignesCompletesPourExport).toHaveBeenCalledWith('jeu1', CONTEXTE, {
      viaArtefact: { proprietaireId: 'proprio' },
    });
  });

  it('renvoie null quand le lot 2 dit « introuvable »', async () => {
    lot2.lignesCompletesPourExport.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'introuvable' })
    );
    expect(await dependancesParDefaut.chargerJeuComplet('jeu1', CONTEXTE)).toBeNull();
  });

  it('n’avale pas la souche « non implemente » du lot 2', async () => {
    lot2.lignesCompletesPourExport.mockRejectedValue(new Error('non implémenté : lot 2'));
    await expect(dependancesParDefaut.chargerJeuComplet('jeu1', CONTEXTE)).rejects.toThrow(
      'non implémenté : lot 2'
    );
  });
});

describe('chargerLignesPourAffichage', () => {
  const page = (numero: number, nb: number, total: number) => ({
    lignes: Array.from({ length: nb }, (_, i) => ({ n: numero * 1000 + i })),
    total,
    totaux: numero === 1 ? { ca: 9 } : undefined,
  });

  it('pagine par 500 jusqu’au total, recalcul a la premiere page seulement', async () => {
    lot2.lireJeu
      .mockResolvedValueOnce(page(1, 500, 1100))
      .mockResolvedValueOnce(page(2, 500, 1100))
      .mockResolvedValueOnce(page(3, 100, 1100));
    const lues = await dependancesParDefaut.chargerLignesPourAffichage!('jeu1', CONTEXTE, {
      recalculer: true,
    });
    expect(lot2.lireJeu.mock.calls.map(c => c[2])).toEqual([
      { recalculer: true, page: 1, taille: 500 },
      { recalculer: false, page: 2, taille: 500 },
      { recalculer: false, page: 3, taille: 500 },
    ]);
    expect(lues?.lignes).toHaveLength(1100);
    expect(lues?.totaux).toEqual({ ca: 9 });
  });

  it('transmet viaArtefact a chaque page, recalcul a la premiere seulement', async () => {
    lot2.lireJeu.mockResolvedValueOnce(page(1, 500, 600)).mockResolvedValueOnce(page(2, 100, 600));
    await dependancesParDefaut.chargerLignesPourAffichage!('jeu1', CONTEXTE, {
      recalculer: true,
      viaArtefact: { proprietaireId: 'proprio' },
    });
    expect(lot2.lireJeu.mock.calls.map(c => c[2])).toEqual([
      { recalculer: true, page: 1, taille: 500, viaArtefact: { proprietaireId: 'proprio' } },
      { recalculer: false, page: 2, taille: 500, viaArtefact: { proprietaireId: 'proprio' } },
    ]);
  });

  it('sans viaArtefact, n’en passe pas au lot 2', async () => {
    lot2.lireJeu.mockResolvedValueOnce(page(1, 3, 3));
    await dependancesParDefaut.chargerLignesPourAffichage!('jeu1', CONTEXTE, { recalculer: false });
    expect(lot2.lireJeu.mock.calls[0][2]).not.toHaveProperty('viaArtefact');
  });

  it('ne demande jamais le recalcul pour le proprietaire', async () => {
    lot2.lireJeu.mockResolvedValueOnce(page(1, 3, 3));
    await dependancesParDefaut.chargerLignesPourAffichage!('jeu1', CONTEXTE, { recalculer: false });
    expect(lot2.lireJeu.mock.calls[0][2].recalculer).toBe(false);
  });

  it('plafonne a 10 000 lignes', async () => {
    lot2.lireJeu.mockImplementation(async (_id, _c, o) => page(o.page, 500, 50_000));
    const lues = await dependancesParDefaut.chargerLignesPourAffichage!('jeu1', CONTEXTE, {
      recalculer: false,
    });
    expect(lues?.lignes).toHaveLength(10_000);
    expect(lot2.lireJeu).toHaveBeenCalledTimes(20);
  });

  it('s’arrete sur une page vide', async () => {
    lot2.lireJeu.mockResolvedValueOnce(page(1, 500, 2000)).mockResolvedValueOnce(page(2, 0, 2000));
    const lues = await dependancesParDefaut.chargerLignesPourAffichage!('jeu1', CONTEXTE, {
      recalculer: false,
    });
    expect(lues?.lignes).toHaveLength(500);
  });
});
