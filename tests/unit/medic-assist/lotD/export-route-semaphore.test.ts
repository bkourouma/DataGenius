/**
 * Route d'export : sémaphore (503 exports_occupes), réponse en flux et erreurs typées rendues
 * avant le premier octet. L'orchestrateur et la garde sont doublés.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const garde = vi.hoisted(() => ({ exigerMedicAssist: vi.fn() }));
vi.mock('@/lib/medic-assist/acces', () => garde);

const orchestrateur = vi.hoisted(() => ({
  construireExport: vi.fn(),
  estFormatExport: (v: unknown) => ['xlsx', 'csv', 'pdf', 'pptx'].includes(v as string),
  LIGNES_MAX_EXPORT: 100_000,
}));
vi.mock('@/lib/medic-assist/artefacts/exports/construire-export', () => orchestrateur);

import { GET, maxDuration } from '@/app/api/medic-assist/artefacts/[id]/export/route';
import {
  DELAI_MAX_FLUX_EXPORT_MS,
  semaphoreExports,
} from '@/lib/medic-assist/artefacts/exports/semaphore';
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

const TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const appeler = (format = 'xlsx') =>
  GET(new NextRequest(`http://localhost/api/medic-assist/artefacts/a1/export?format=${format}`), {
    params: { id: 'a1' },
  });

const fichier = () => ({ buffer: Buffer.from('PKx'), nomFichier: 'a.xlsx', typeMime: TYPE_XLSX });

let prises: (() => void)[] = [];
function remplir() {
  for (let i = 0; i < semaphoreExports.capacite; i += 1) {
    const liberer = semaphoreExports.essayerPrendre();
    if (liberer) prises.push(liberer);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  garde.exigerMedicAssist.mockResolvedValue({
    ok: true,
    session: { user: { id: 'u1', name: 'Aïcha Diallo' } },
    scope: CONTEXTE.scope,
    contexte: CONTEXTE,
  });
});

afterEach(() => {
  prises.forEach(liberer => liberer());
  prises = [];
  expect(semaphoreExports.utilisees).toBe(0);
});

describe('GET export : sémaphore', () => {
  it('fixe une durée maximale de 120 secondes', () => {
    expect(maxDuration).toBe(120);
  });

  it('répond 503 exports_occupes avec Retry-After quand les 2 places sont prises', async () => {
    remplir();
    const r = await appeler();
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('10');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    const corps = await r.json();
    expect(corps.error).toBe('ServiceUnavailable');
    expect(corps.code).toBe('exports_occupes');
    expect(typeof corps.message).toBe('string');
    expect(corps.message.length).toBeGreaterThan(0);
    // Rien n'est calculé quand le sémaphore est plein.
    expect(orchestrateur.construireExport).not.toHaveBeenCalled();
  });

  it('refuse le troisième export simultané et accepte les deux premiers', async () => {
    const attente: ((v: unknown) => void)[] = [];
    orchestrateur.construireExport.mockImplementation(
      () => new Promise(resolve => attente.push(resolve))
    );
    const a = appeler();
    const b = appeler();
    await vi.waitFor(() => expect(orchestrateur.construireExport).toHaveBeenCalledTimes(2));
    const c = await appeler();
    expect(c.status).toBe(503);
    expect(orchestrateur.construireExport).toHaveBeenCalledTimes(2);
    attente.forEach(resolve => resolve(fichier()));
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    // Les places sont rendues : un nouvel export passe.
    orchestrateur.construireExport.mockResolvedValue(fichier());
    expect((await appeler()).status).toBe(200);
  });

  it('rend la place après un succès, une erreur typée et une erreur imprévue', async () => {
    orchestrateur.construireExport.mockResolvedValueOnce(fichier());
    expect((await appeler()).status).toBe(200);
    expect(semaphoreExports.utilisees).toBe(0);
    orchestrateur.construireExport.mockRejectedValueOnce(new ErreurExport('introuvable'));
    expect((await appeler()).status).toBe(404);
    expect(semaphoreExports.utilisees).toBe(0);
    orchestrateur.construireExport.mockRejectedValueOnce(new Error('boum'));
    expect((await appeler()).status).toBe(500);
    expect(semaphoreExports.utilisees).toBe(0);
  });

  it.each([
    ['trop_de_lignes', 413],
    ['introuvable', 404],
    ['jeu_indisponible', 404],
    ['format_non_supporte', 400],
    ['echec', 500],
  ] as const)('garde l’erreur typée %s (%i) avant tout flux', async (code, status) => {
    orchestrateur.construireExport.mockRejectedValueOnce(new ErreurExport(code));
    const r = await appeler();
    expect(r.status).toBe(status);
    expect(r.headers.get('content-type')).toContain('application/json');
  });

  it('garde le 429 avec Retry-After du délai de débit', async () => {
    orchestrateur.construireExport.mockRejectedValueOnce(
      new ErreurExport('limite_debit', undefined, 120_000)
    );
    const r = await appeler();
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('120');
  });
});

function fluxDe(morceaux: string[], erreurApres?: Error) {
  const encodeur = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < morceaux.length) c.enqueue(encodeur.encode(morceaux[i++]));
      else if (erreurApres) c.error(erreurApres);
      else c.close();
    },
  });
}

describe('GET export : réponse en flux', () => {
  it('renvoie le flux sans Content-Length avec les en-têtes habituels, puis libère la place', async () => {
    orchestrateur.construireExport.mockResolvedValue({
      flux: fluxDe(['PK', 'données']),
      nomFichier: 'Écarts 2026-11-02.xlsx',
      typeMime: TYPE_XLSX,
    });
    const r = await appeler();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(TYPE_XLSX);
    expect(r.headers.get('content-length')).toBeNull();
    expect(r.headers.get('content-disposition')).toContain('attachment; filename=');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    // La place reste prise tant que le flux est en cours.
    expect(semaphoreExports.utilisees).toBe(1);
    expect(await r.text()).toBe('PKdonnées');
    expect(semaphoreExports.utilisees).toBe(0);
  });

  it('un flux en cours garde sa place : le 3e export concurrent est refusé', async () => {
    orchestrateur.construireExport.mockImplementation(async () => ({
      flux: fluxDe(['a']),
      nomFichier: 'a.xlsx',
      typeMime: TYPE_XLSX,
    }));
    const a = await appeler();
    const b = await appeler();
    expect((await appeler()).status).toBe(503);
    await a.text();
    const d = await appeler();
    expect(d.status).toBe(200);
    await d.text();
    await b.text();
  });

  it('libère la place quand le client annule', async () => {
    orchestrateur.construireExport.mockResolvedValue({
      flux: fluxDe(['a', 'b', 'c']),
      nomFichier: 'a.xlsx',
      typeMime: TYPE_XLSX,
    });
    const r = await appeler();
    expect(semaphoreExports.utilisees).toBe(1);
    await r.body!.cancel();
    expect(semaphoreExports.utilisees).toBe(0);
  });

  it('annule la réponse et libère la place sur une erreur en cours de flux, sans journaliser de données', async () => {
    orchestrateur.construireExport.mockResolvedValue({
      flux: fluxDe(['PK'], new TypeError('secret : SELECT * FROM table_privee')),
      nomFichier: 'a.xlsx',
      typeMime: TYPE_XLSX,
    });
    const r = await appeler();
    expect(r.status).toBe(200);
    await expect(r.text()).rejects.toBeDefined();
    expect(semaphoreExports.utilisees).toBe(0);
    const journal = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(journal).toContain('TypeError');
    expect(journal).not.toContain('table_privee');
  });

  it('annule le flux et rend la place après 5 minutes sans lecture', async () => {
    vi.useFakeTimers();
    try {
      orchestrateur.construireExport.mockResolvedValue({
        // Flux source qui ne produit jamais rien : client ou source bloqué.
        flux: new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }),
        nomFichier: 'a.xlsx',
        typeMime: TYPE_XLSX,
      });
      const r = await appeler();
      expect(r.status).toBe(200);
      const lecture = r.text().catch(e => e);
      expect(semaphoreExports.utilisees).toBe(1);
      await vi.advanceTimersByTimeAsync(DELAI_MAX_FLUX_EXPORT_MS - 1000);
      expect(semaphoreExports.utilisees).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(semaphoreExports.utilisees).toBe(0);
      expect(await lecture).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ne laisse aucun minuteur actif quand le flux se termine normalement', async () => {
    vi.useFakeTimers();
    try {
      orchestrateur.construireExport.mockResolvedValue({
        flux: fluxDe(['PK']),
        nomFichier: 'a.xlsx',
        typeMime: TYPE_XLSX,
      });
      const r = await appeler();
      await r.text();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
