/**
 * Limite de débit des rejeux (50 par 10 min) côté artefacts : lecture (jeu omis + délai
 * exposé), réponse d'erreur 429 et conversion en client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: {}, default: {} }));
vi.mock('@/lib/medic-assist/donnees/outils', () => ({
  lireJeu: vi.fn(),
  lignesCompletesPourExport: vi.fn(),
}));

const stockage = vi.hoisted(() => ({ lireArtefact: vi.fn() }));
vi.mock('@/lib/medic-assist/artefacts/stockage-impl', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/artefacts/stockage-impl')>()),
  lireArtefact: stockage.lireArtefact,
}));

import { reponseVersClient } from '@/lib/medic-assist/artefacts/client-mapper';
import type { ContexteExecution } from '@/lib/medic-assist/contrats';
import { ErreurExport, type DependancesArtefacts } from '@/lib/medic-assist/artefacts/ports';
import {
  construireReponseArtefact,
  reponseErreurArtefact,
} from '@/lib/medic-assist/artefacts/service-reponse';
import { ErreurDonnees } from '@/lib/medic-assist/donnees/types';

import { artefactTest, jeuTest, reponseApi } from './_fixtures-artefacts-ui';

const CONTEXTE = {
  userId: 'u-1',
  roleName: 'TenantAdmin',
  scope: { isGlobal: true },
  habilitations: null,
  locale: 'fr',
  maintenant: new Date(2026, 10, 2),
  jourLimite: 10,
} as unknown as ContexteExecution;

function limite(ms: number | undefined = 125_000) {
  return new ErreurDonnees('trop de rejeux', 'limite_debit_donnees', ms);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { donnees: _d, ...dto } = reponseApi(artefactTest('tableau'));
  void _d;
  stockage.lireArtefact.mockResolvedValue(dto);
});

describe('construireReponseArtefact : limite de débit', () => {
  it('omet le jeu et expose le délai en secondes dans jeuxLimites', async () => {
    const deps = {
      chargerLignesPourAffichage: vi.fn().mockRejectedValue(limite(125_000)),
    } as unknown as DependancesArtefacts;
    const r = await construireReponseArtefact(CONTEXTE, 'art-tableau', { deps });
    expect(r.donnees).toEqual({});
    expect(r.jeuxLimites).toEqual({ 'jeu-1': { reessayerDansSecondes: 125 } });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('une autre erreur omet le jeu, journalise le nom seul et ne remplit pas jeuxLimites', async () => {
    const deps = {
      chargerLignesPourAffichage: vi.fn().mockRejectedValue(new Error('SELECT secret')),
    } as unknown as DependancesArtefacts;
    const r = await construireReponseArtefact(CONTEXTE, 'art-tableau', { deps });
    expect(r.donnees).toEqual({});
    expect(r.jeuxLimites).toBeUndefined();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret');
  });

  it('sans limite, jeuxLimites est absent', async () => {
    const jeu = jeuTest();
    const deps = {
      chargerLignesPourAffichage: vi.fn().mockResolvedValue({ lignes: jeu.lignes }),
    } as unknown as DependancesArtefacts;
    const r = await construireReponseArtefact(CONTEXTE, 'art-tableau', { deps });
    expect(r.donnees['jeu-1']).toBeDefined();
    expect('jeuxLimites' in r).toBe(false);
  });
});

describe('reponseErreurArtefact : limite de débit', () => {
  it('ErreurDonnees limite -> 429, Retry-After en secondes, code stable', async () => {
    const r = reponseErreurArtefact(limite(90_000));
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('90');
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    const corps = await r.json();
    expect(corps).toMatchObject({ error: 'TooManyRequests', code: 'limite_debit_donnees' });
    expect(corps.message).toBe('Too many recalculations. Try again in a few minutes.');
  });

  it('ErreurExport limite_debit -> 429 ; délai absent : repli 60 s', () => {
    const r = reponseErreurArtefact(new ErreurExport('limite_debit', undefined, 400));
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('1');
    expect(
      reponseErreurArtefact(new ErreurDonnees('x', 'limite_debit_donnees')).headers.get('Retry-After')
    ).toBe('60');
  });

  it('les autres erreurs restent en 500', () => {
    expect(reponseErreurArtefact(new Error('x')).status).toBe(500);
  });
});

describe('reponseVersClient : jeuxLimites', () => {
  it('pose limiteDebit sur le jeu sans lignes', () => {
    const reponse = reponseApi(artefactTest('tableau'));
    reponse.donnees = {};
    reponse.jeuxLimites = { 'jeu-1': { reessayerDansSecondes: 125 } };
    const client = reponseVersClient(reponse);
    expect(client.jeux['jeu-1'].limiteDebit).toEqual({ reessayerDansSecondes: 125 });
    expect(client.jeux['jeu-1'].lignes).toEqual([]);
  });

  it('pas de limiteDebit quand le jeu a ses lignes', () => {
    const reponse = reponseApi(artefactTest('tableau'));
    reponse.jeuxLimites = { 'jeu-1': { reessayerDansSecondes: 5 } };
    expect(reponseVersClient(reponse).jeux['jeu-1'].limiteDebit).toBeUndefined();
  });
});

