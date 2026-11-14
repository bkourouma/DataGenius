/** Sémaphore d'exports : global, non bloquant, libération idempotente. */
import { describe, expect, it } from 'vitest';

import {
  creerSemaphore,
  EXPORTS_SIMULTANES_MAX,
  semaphoreExports,
} from '@/lib/medic-assist/artefacts/exports/semaphore';

describe('sémaphore d’exports', () => {
  it('autorise 2 exports simultanés par défaut', () => {
    expect(EXPORTS_SIMULTANES_MAX).toBe(2);
    expect(semaphoreExports.capacite).toBe(2);
  });

  it('refuse le troisième appel simultané sans attendre', () => {
    const s = creerSemaphore(2);
    const a = s.essayerPrendre();
    const b = s.essayerPrendre();
    const c = s.essayerPrendre();
    expect(a).toBeTypeOf('function');
    expect(b).toBeTypeOf('function');
    expect(c).toBeNull();
    expect(s.utilisees).toBe(2);
  });

  it('rend la place après un succès', () => {
    const s = creerSemaphore(1);
    const liberer = s.essayerPrendre()!;
    liberer();
    expect(s.utilisees).toBe(0);
    expect(s.essayerPrendre()).toBeTypeOf('function');
  });

  it('rend la place après une erreur (finally)', async () => {
    const s = creerSemaphore(1);
    await expect(
      (async () => {
        const liberer = s.essayerPrendre()!;
        try {
          throw new Error('échec');
        } finally {
          liberer();
        }
      })()
    ).rejects.toThrow('échec');
    expect(s.essayerPrendre()).not.toBeNull();
  });

  it('une libération répétée ne rend qu’une place', () => {
    const s = creerSemaphore(2);
    const a = s.essayerPrendre()!;
    s.essayerPrendre();
    a();
    a();
    a();
    expect(s.utilisees).toBe(1);
    expect(s.essayerPrendre()).not.toBeNull();
    expect(s.essayerPrendre()).toBeNull();
  });

  it('a une capacité surchargeable', () => {
    const s = creerSemaphore(1);
    s.essayerPrendre();
    expect(s.essayerPrendre()).toBeNull();
    s.capacite = 3;
    expect(s.essayerPrendre()).not.toBeNull();
  });
});
