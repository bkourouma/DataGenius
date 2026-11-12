/**
 * Route GET /api/medic-assist/artefacts/[id]/export.
 * La garde du lot 0 (`@/lib/medic-assist/acces`) et l'orchestrateur sont doublés ; le contrat
 * HTTP (statuts, en-têtes, messages génériques, contexte issu de la session) est vérifié pour de vrai.
 */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const garde = vi.hoisted(() => ({ exigerMedicAssist: vi.fn() }));
vi.mock('@/lib/medic-assist/acces', () => garde);

const orchestrateur = vi.hoisted(() => ({
  construireExport: vi.fn(),
  estFormatExport: (v: unknown) => ['xlsx', 'csv', 'pdf', 'pptx'].includes(v as string),
  LIGNES_MAX_EXPORT: 100_000,
}));
vi.mock('@/lib/medic-assist/artefacts/exports/construire-export', () => orchestrateur);

import { GET } from '@/app/api/medic-assist/artefacts/[id]/export/route';
import { ErreurExport } from '@/lib/medic-assist/artefacts/ports';

const CONTEXTE = {
  userId: 'u1',
  roleName: 'CountryLead',
  scope: { isGlobal: false },
  habilitations: null,
  locale: 'fr',
  maintenant: new Date(2026, 10, 2),
  jourLimite: 10,
};

function connecte() {
  garde.exigerMedicAssist.mockResolvedValue({
    ok: true,
    session: { user: { id: 'u1', name: 'Aïcha Diallo' } },
    scope: CONTEXTE.scope,
    contexte: CONTEXTE,
  });
}

function requete(query = '?format=xlsx') {
  return new NextRequest(`http://localhost/api/medic-assist/artefacts/a1/export${query}`);
}

const appeler = (query?: string, id = 'a1') => GET(requete(query), { params: { id } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  connecte();
});

describe('GET /api/medic-assist/artefacts/[id]/export', () => {
  it('propage le refus de la garde (401 puis 403) sans rien construire', async () => {
    garde.exigerMedicAssist.mockResolvedValueOnce({
      ok: false,
      reponse: NextResponse.json({ error: 'Unauthorized', message: 'x' }, { status: 401 }),
    });
    expect((await appeler()).status).toBe(401);
    garde.exigerMedicAssist.mockResolvedValueOnce({
      ok: false,
      reponse: NextResponse.json({ error: 'Forbidden', message: 'x' }, { status: 403 }),
    });
    expect((await appeler()).status).toBe(403);
    expect(orchestrateur.construireExport).not.toHaveBeenCalled();
  });

  it.each(['?format=docx', '?format=', '', '?format=XLSX'])(
    'refuse le format %j (400)',
    async query => {
      const r = await appeler(query);
      expect(r.status).toBe(400);
      const corps = await r.json();
      expect(corps.error).toBe('BadRequest');
      expect(corps.message).toContain('xlsx');
      expect(orchestrateur.construireExport).not.toHaveBeenCalled();
    }
  );

  it.each(['a b', 'a/../b', 'x'.repeat(65), 'é'])(
    'refuse l’identifiant invalide %j (400) avant tout accès aux données',
    async id => {
      const r = await appeler('?format=xlsx', id);
      expect(r.status).toBe(400);
      const corps = await r.json();
      expect(corps.error).toBe('BadRequest');
      expect(typeof corps.message).toBe('string');
      expect(orchestrateur.construireExport).not.toHaveBeenCalled();
    }
  );

  it('renvoie le fichier avec les bons en-têtes', async () => {
    orchestrateur.construireExport.mockResolvedValue({
      buffer: Buffer.from('PKcontenu'),
      nomFichier: 'Écarts d’été 2026-11-02.xlsx',
      typeMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const r = await appeler('?format=xlsx');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(r.headers.get('content-disposition')).toBe(
      `attachment; filename="Ecarts d_ete 2026-11-02.xlsx"; filename*=UTF-8''%C3%89carts%20d%E2%80%99%C3%A9t%C3%A9%202026-11-02.xlsx`
    );
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-length')).toBe('9');
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('PKcontenu');
  });

  it('prend le contexte de la session, jamais du client', async () => {
    orchestrateur.construireExport.mockResolvedValue({
      buffer: Buffer.from('x'),
      nomFichier: 'a.csv',
      typeMime: 'text/csv; charset=utf-8',
    });
    await appeler('?format=csv&userId=pirate&locale=ar&scope=tous', 'abc');
    expect(orchestrateur.construireExport).toHaveBeenCalledTimes(1);
    const [contexte, id, format, options] = orchestrateur.construireExport.mock.calls[0];
    expect(id).toBe('abc');
    expect(format).toBe('csv');
    expect(contexte).toBe(CONTEXTE);
    expect(contexte.userId).toBe('u1');
    expect(options).toEqual({ version: undefined, exportePar: 'Aïcha Diallo' });
  });

  it('transmet la version demandée et refuse une version invalide (400)', async () => {
    orchestrateur.construireExport.mockResolvedValue({
      buffer: Buffer.from('x'),
      nomFichier: 'a.pdf',
      typeMime: 'application/pdf',
    });
    await appeler('?format=pdf&version=3');
    expect(orchestrateur.construireExport.mock.calls[0][3]).toEqual({
      version: 3,
      exportePar: 'Aïcha Diallo',
    });
    for (const query of [
      '?format=pdf&version=0',
      '?format=pdf&version=abc',
      '?format=pdf&version=-1',
    ]) {
      expect((await appeler(query)).status).toBe(400);
    }
    expect(orchestrateur.construireExport).toHaveBeenCalledTimes(1);
  });

  it('répond 404 identique pour un artefact absent, d’un autre utilisateur ou un jeu refusé', async () => {
    const corps: unknown[] = [];
    for (const code of ['introuvable', 'jeu_indisponible'] as const) {
      orchestrateur.construireExport.mockRejectedValueOnce(new ErreurExport(code));
      const r = await appeler();
      expect(r.status).toBe(404);
      corps.push(await r.json());
    }
    expect(corps[0]).toEqual(corps[1]);
    expect((corps[0] as { error: string }).error).toBe('NotFound');
  });

  it('traduit les autres erreurs d’export (400, 413)', async () => {
    orchestrateur.construireExport.mockRejectedValueOnce(new ErreurExport('format_non_supporte'));
    const a = await appeler('?format=csv');
    expect(a.status).toBe(400);
    expect((await a.json()).message).toContain('format');

    orchestrateur.construireExport.mockRejectedValueOnce(new ErreurExport('trop_de_lignes'));
    const b = await appeler();
    expect(b.status).toBe(413);
    expect((await b.json()).message).toContain('trop de lignes');
  });

  it('répond 429 avec Retry-After, code et message traduit pour la limite de débit', async () => {
    orchestrateur.construireExport.mockRejectedValueOnce(
      new ErreurExport('limite_debit', undefined, 125_000)
    );
    const r = await appeler();
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('125');
    const corps = await r.json();
    expect(corps.error).toBe('TooManyRequests');
    expect(corps.code).toBe('limite_debit_donnees');
    expect(corps.message).toContain('3 minutes');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('Retry-After vaut au moins 1 seconde', async () => {
    orchestrateur.construireExport.mockRejectedValueOnce(new ErreurExport('limite_debit', undefined, 10));
    const r = await appeler();
    expect(r.headers.get('Retry-After')).toBe('1');
    expect((await r.json()).message).toContain('1 minute');
  });

  it('répond 500 générique sans détail interne et journalise sans données', async () => {
    orchestrateur.construireExport.mockRejectedValueOnce(
      new Error('ECONNREFUSED postgres://admin:motdepasse@db/prod table ventes')
    );
    const r = await appeler();
    expect(r.status).toBe(500);
    const texte = JSON.stringify(await r.json());
    expect(texte).not.toMatch(/ECONNREFUSED|postgres|motdepasse|ventes/);
    expect(JSON.parse(texte).error).toBe('ExportFailed');
    const journal = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(journal).not.toMatch(/postgres|motdepasse|ventes/);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('répond 500 pour une ErreurExport echec, cause jamais exposée', async () => {
    const e = new ErreurExport('echec');
    (e as { cause?: unknown }).cause = new Error('détail secret');
    orchestrateur.construireExport.mockRejectedValueOnce(e);
    const r = await appeler();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('secret');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret');
  });
});
