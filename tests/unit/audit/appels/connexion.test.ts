import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  audit: vi.fn(), findFirst: vi.fn(), update: vi.fn(),
  reserver: vi.fn(), reinitialiser: vi.fn(),
  faux: vi.fn(), verify: vi.fn(), hash: vi.fn(), rehacher: vi.fn(),
}))

vi.mock('@/lib/audit/enregistrer', () => ({ enregistrerAudit: m.audit }))
vi.mock('@/lib/db/client', () => ({ prisma: { user: { findFirst: m.findFirst, update: m.update } } }))
vi.mock('@/lib/auth/oidc', () => ({
  configurationOidc: () => null, FOURNISSEUR_OIDC: 'oidc', fournisseurOidc: vi.fn(), trouverUtilisateurOidc: vi.fn(),
}))
vi.mock('@/lib/auth/password', () => ({
  verifierFauxMotDePasse: m.faux, verifyPassword: m.verify, hashPassword: m.hash, doitRehacher: m.rehacher,
}))
vi.mock('@/lib/auth/limite-connexion', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth/limite-connexion')>('@/lib/auth/limite-connexion')),
  reserverTentative: m.reserver, reinitialiser: m.reinitialiser,
}))

import { reinitialiserBlocages } from '@/lib/audit/blocage'
import { autoriserConnexion } from '@/lib/auth/config'

const req = { headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4' } }
const EMAIL = 'jeanne@example.fr'
const MDP = 'mot-de-passe-secret-12'
const creds = { email: ' Jeanne@Example.fr ', password: MDP }
const utilisateur = { id: 'u1', email: EMAIL, firstName: 'Jeanne', lastName: 'D', roleName: 'Member', passwordHash: 'h' }

function sansSecrets() {
  const s = JSON.stringify(m.audit.mock.calls).toLowerCase()
  expect(s).not.toContain('jeanne@')
  expect(s).not.toContain('example.fr')
  expect(s).not.toContain(MDP)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DATAGENIUS_PROXY_DE_CONFIANCE', '1')
  reinitialiserBlocages()
  m.reserver.mockResolvedValue(true)
  m.audit.mockResolvedValue(undefined)
  m.rehacher.mockReturnValue(false)
})

describe('connexion réussie', () => {
  it('un appel connexion.reussie avec acteur et IP, après la vérification', async () => {
    m.findFirst.mockResolvedValue(utilisateur)
    m.verify.mockResolvedValue(true)
    expect(await autoriserConnexion(creds, req)).toMatchObject({ id: 'u1' })
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      acteurId: 'u1', action: 'connexion.reussie', cible: { type: 'utilisateur', id: 'u1' }, ip: '1.2.3.4',
    }))
    expect(m.verify.mock.invocationCallOrder[0]!).toBeLessThan(m.audit.mock.invocationCallOrder[0]!)
    expect(m.reinitialiser.mock.invocationCallOrder[0]!).toBeLessThan(m.audit.mock.invocationCallOrder[0]!)
    sansSecrets()
  })
})

describe('échecs indistinguables', () => {
  it('compte inconnu et mauvais mot de passe : une écriture chacun, même action et même résultat', async () => {
    m.findFirst.mockResolvedValue(null)
    expect(await autoriserConnexion(creds, req)).toBeNull()
    const inconnu = m.audit.mock.calls.map(c => c[0])
    sansSecrets()

    m.audit.mockClear()
    m.findFirst.mockResolvedValue(utilisateur)
    m.verify.mockResolvedValue(false)
    expect(await autoriserConnexion(creds, req)).toBeNull()
    const mauvais = m.audit.mock.calls.map(c => c[0])
    sansSecrets()

    expect(inconnu).toHaveLength(1)
    expect(mauvais).toHaveLength(1)
    for (const a of [inconnu[0], mauvais[0]]) expect(a).toMatchObject({ action: 'connexion.echec', resultat: 'echec', ip: '1.2.3.4' })
    expect(inconnu[0].acteurId).toBeUndefined()
    expect(mauvais[0].acteurId).toBe('u1')
    expect(m.faux).toHaveBeenCalledTimes(1)
  })
})

describe('blocage', () => {
  it('lève trop_de_tentatives et n’écrit connexion.bloquee qu’une fois par e-mail', async () => {
    m.reserver.mockResolvedValue(false)
    for (let i = 0; i < 5; i++) await expect(autoriserConnexion(creds, req)).rejects.toThrow('trop_de_tentatives')
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'connexion.bloquee', resultat: 'refuse', ip: '1.2.3.4' }))
    expect(m.audit.mock.calls[0]![0].acteurId).toBeUndefined()

    await expect(autoriserConnexion({ email: 'autre@example.fr', password: MDP }, req)).rejects.toThrow('trop_de_tentatives')
    expect(m.audit).toHaveBeenCalledTimes(2)
    sansSecrets()
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain('autre@')
    expect(m.findFirst).not.toHaveBeenCalled()
  })
})

describe('non-régression d’ordre', () => {
  it('un rehachage en échec n’empêche pas la connexion : métier puis audit', async () => {
    m.findFirst.mockResolvedValue(utilisateur)
    m.verify.mockResolvedValue(true)
    m.rehacher.mockReturnValue(true)
    m.hash.mockRejectedValue(new Error('boom'))
    expect(await autoriserConnexion(creds, req)).toMatchObject({ id: 'u1' })
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.verify.mock.invocationCallOrder[0]!).toBeLessThan(m.audit.mock.invocationCallOrder[0]!)
  })
})
