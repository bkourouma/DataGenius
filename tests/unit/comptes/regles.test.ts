import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ prisma: {} }))
vi.mock('@/lib/mail/transport', () => ({ envoyerMail: vi.fn(async () => true), mailConfigure: () => false }))

import { ErreurComptes } from '@/lib/auth/comptes'
import {
  INVITATION_VALIDITE_MS, MAX_DEMANDES_PAR_HEURE, REINITIALISATION_VALIDITE_MS, genererJeton, hacherJeton,
  jetonUtilisable, lienDefinitionMotDePasse, limiteDemandesAtteinte, normaliserEmail, validerEmail,
  validerMotDePasse, verifierChangementRole, verifierDesactivation,
} from '@/lib/auth/comptes-regles'

const admin = { id: 'a1', roleName: 'TenantAdmin', status: 'active' }
const membre = { id: 'm1', roleName: 'Member', status: 'active' }

afterEach(() => vi.unstubAllEnvs())

describe('jetons', () => {
  it('génère 43 caractères base64url, différents à chaque appel', () => {
    const a = genererJeton()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(genererJeton()).not.toBe(a)
  })
  it('hache de façon stable en SHA-256 hexadécimal', () => {
    expect(hacherJeton('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hacherJeton('abc')).toBe(hacherJeton('abc'))
  })
  it('refuse un jeton expiré ou utilisé', () => {
    const now = new Date('2026-11-13T10:00:00Z')
    expect(jetonUtilisable({ expireA: new Date(now.getTime() + 1000), utiliseA: null }, now)).toBe(true)
    expect(jetonUtilisable({ expireA: new Date(now.getTime() - 1), utiliseA: null }, now)).toBe(false)
    expect(jetonUtilisable({ expireA: now, utiliseA: null }, now)).toBe(false)
    expect(jetonUtilisable({ expireA: new Date(now.getTime() + 1000), utiliseA: now }, now)).toBe(false)
  })
  it('expose les durées et la limite', () => {
    expect(INVITATION_VALIDITE_MS).toBe(7 * 24 * 3600 * 1000)
    expect(REINITIALISATION_VALIDITE_MS).toBe(3600 * 1000)
    expect(MAX_DEMANDES_PAR_HEURE).toBe(3)
    expect([0, 2, 3, 4].map(limiteDemandesAtteinte)).toEqual([false, false, true, true])
  })
})

describe('mot de passe et e-mail', () => {
  it('accepte 12 à 256 caractères seulement', () => {
    expect(() => validerMotDePasse('a'.repeat(11))).toThrow(ErreurComptes)
    expect(() => validerMotDePasse('a'.repeat(12))).not.toThrow()
    expect(() => validerMotDePasse('a'.repeat(256))).not.toThrow()
    expect(() => validerMotDePasse('a'.repeat(257))).toThrow(ErreurComptes)
  })
  it('normalise et valide les e-mails', () => {
    expect(normaliserEmail('  Jean@Example.COM ')).toBe('jean@example.com')
    expect(validerEmail(' A@B.co ')).toBe('a@b.co')
    expect(() => validerEmail('pas-un-email')).toThrow(ErreurComptes)
    expect(() => validerEmail('a'.repeat(250) + '@b.co')).toThrow(ErreurComptes)
  })
})

describe('lien', () => {
  it('utilise NEXTAUTH_URL puis APP_URL, sans slash final', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://dg.example.test//')
    expect(lienDefinitionMotDePasse('tok')).toBe('https://dg.example.test/definir-mot-de-passe?jeton=tok')
    vi.stubEnv('NEXTAUTH_URL', '')
    vi.stubEnv('APP_URL', 'https://app.example.test/')
    expect(lienDefinitionMotDePasse('tok')).toBe('https://app.example.test/definir-mot-de-passe?jeton=tok')
  })
  it("refuse sans URL publique", () => {
    vi.stubEnv('NEXTAUTH_URL', '')
    vi.stubEnv('APP_URL', '')
    expect(() => lienDefinitionMotDePasse('tok')).toThrow("NEXTAUTH_URL n'est pas configurée")
  })
})

describe('dernier administrateur', () => {
  it("interdit de se désactiver soi-même", () => {
    expect(() => verifierDesactivation('a1', admin, 3)).toThrow(ErreurComptes)
    expect(() => verifierDesactivation('m1', membre, 1)).toThrow(ErreurComptes)
  })
  it('interdit de désactiver le dernier administrateur actif', () => {
    expect(() => verifierDesactivation('autre', admin, 1)).toThrow('dernier administrateur')
    expect(() => verifierDesactivation('autre', admin, 2)).not.toThrow()
    expect(() => verifierDesactivation('autre', membre, 1)).not.toThrow()
  })
  it('interdit de rétrograder le dernier administrateur, soi-même compris', () => {
    expect(() => verifierChangementRole('autre', admin, 'Member', 1)).toThrow(ErreurComptes)
    expect(() => verifierChangementRole('a1', admin, 'Member', 1)).toThrow('retirer votre propre rôle')
    expect(() => verifierChangementRole('a1', admin, 'Member', 2)).not.toThrow()
    expect(() => verifierChangementRole('autre', membre, 'TenantAdmin', 1)).not.toThrow()
    expect(() => verifierChangementRole('autre', admin, 'Inconnu', 5)).toThrow(ErreurComptes)
  })
  it('un administrateur désactivé ou invité ne compte pas comme dernier admin actif', () => {
    expect(() => verifierChangementRole('x', { ...admin, status: 'disabled' }, 'Member', 1)).not.toThrow()
    expect(() => verifierDesactivation('x', { ...admin, status: 'invited' }, 1)).not.toThrow()
  })
})
