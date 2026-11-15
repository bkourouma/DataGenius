/** Lot D : limite de 1 Mo (octets UTF-8) sur la specification d'un artefact. */
import { describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  assistantArtefact: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  assistantJeuDeDonnees: { findMany: vi.fn() },
  assistantConversation: { findFirst: vi.fn() },
}))
vi.mock('@/lib/db/client', () => ({ prisma: db, default: db }))

import {
  creerArtefact,
  ErreurArtefact,
  modifierArtefact,
  SPEC_TAILLE_MAX_OCTETS,
  validerSpec,
} from '@/lib/medic-assist/artefacts/stockage-impl'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'

const CTX = { userId: 'u1', conversationId: null } as unknown as ContexteExecution

/** Spec de document dont le JSON fait exactement `octets` octets (remplissage ASCII). */
function specDeTaille(octets: number) {
  const fabrique = (n: number) => ({
    type: 'document',
    titre: 'Gros',
    blocs: [{ type: 'texte', markdown: 'a'.repeat(n) }],
  })
  const base = Buffer.byteLength(JSON.stringify(fabrique(0)))
  return fabrique(octets - base)
}

describe('taille de la spec', () => {
  it('constante de 1 Mo', () => {
    expect(SPEC_TAILLE_MAX_OCTETS).toBe(1_048_576)
  })

  it('refuse 1 Mo + 1 octet avec spec_invalide (message de taille)', () => {
    const spec = specDeTaille(SPEC_TAILLE_MAX_OCTETS + 1)
    expect(Buffer.byteLength(JSON.stringify(spec))).toBe(SPEC_TAILLE_MAX_OCTETS + 1)
    let erreur: unknown
    try {
      validerSpec(spec)
    } catch (e) {
      erreur = e
    }
    expect(erreur).toBeInstanceOf(ErreurArtefact)
    expect((erreur as ErreurArtefact).code).toBe('spec_invalide')
    expect((erreur as ErreurArtefact).message).toMatch(/volumineuse/)
  })

  it('mesure en octets UTF-8, pas en caracteres', () => {
    // 600 000 caracteres de 2 octets : moins d'1 M de caracteres, plus d'1 Mo.
    const spec = {
      type: 'document',
      titre: 'Gros',
      blocs: [{ type: 'texte', markdown: 'é'.repeat(600_000) }],
    }
    expect(() => validerSpec(spec)).toThrowError(/volumineuse/)
  })

  it('a exactement 1 Mo, la spec n est pas rejetee pour sa taille', () => {
    const spec = specDeTaille(SPEC_TAILLE_MAX_OCTETS)
    expect(Buffer.byteLength(JSON.stringify(spec))).toBe(SPEC_TAILLE_MAX_OCTETS)
    let code = ''
    try {
      validerSpec(spec)
    } catch (e) {
      code = (e as ErreurArtefact).message
    }
    expect(code).not.toMatch(/volumineuse/)
  })

  it('creation et nouvelle version : refus avant toute lecture ou ecriture en base', async () => {
    const spec = specDeTaille(SPEC_TAILLE_MAX_OCTETS + 1)
    await expect(creerArtefact(CTX, { spec } as never)).rejects.toMatchObject({
      code: 'spec_invalide',
      message: expect.stringContaining('volumineuse'),
    })
    await expect(modifierArtefact(CTX, { artefactId: 'a', spec } as never)).rejects.toMatchObject({
      code: 'spec_invalide',
      message: expect.stringContaining('volumineuse'),
    })
    expect(db.assistantArtefact.create).not.toHaveBeenCalled()
    expect(db.assistantArtefact.findFirst).not.toHaveBeenCalled()
  })

  it('une spec normale reste acceptee', () => {
    expect(validerSpec({ type: 'tableau', titre: 'CA', jeuDeDonneesId: 'jeu1' }).type).toBe(
      'tableau'
    )
  })
})
