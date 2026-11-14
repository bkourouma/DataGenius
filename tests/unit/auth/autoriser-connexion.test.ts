import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), update: vi.fn(),
  reserver: vi.fn(), reinitialiser: vi.fn(),
  faux: vi.fn(), verify: vi.fn(), hash: vi.fn(), rehacher: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ prisma: { user: { findFirst: mocks.findFirst, update: mocks.update } } }))
vi.mock('@/lib/auth/oidc', () => ({
  configurationOidc: () => null, FOURNISSEUR_OIDC: 'oidc', fournisseurOidc: vi.fn(), trouverUtilisateurOidc: vi.fn(),
}))
vi.mock('@/lib/auth/password', () => ({
  verifierFauxMotDePasse: mocks.faux, verifyPassword: mocks.verify, hashPassword: mocks.hash, doitRehacher: mocks.rehacher,
}))
vi.mock('@/lib/auth/limite-connexion', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth/limite-connexion')>('@/lib/auth/limite-connexion')),
  reserverTentative: mocks.reserver, reinitialiser: mocks.reinitialiser,
}))

import { autoriserConnexion } from '@/lib/auth/config'

process.env.DATAGENIUS_PROXY_DE_CONFIANCE = '1'
const req = { headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4' } }
const creds = { email: ' Jeanne@Example.fr ', password: 'mot-de-passe-12' }
const utilisateur = { id: 'u1', email: 'jeanne@example.fr', firstName: 'Jeanne', lastName: 'D', roleName: 'Member', passwordHash: 'ancien' }

describe('autoriserConnexion', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.reserver.mockResolvedValue(true)
  })

  it('refuse une entrée invalide sans rien consulter', async () => {
    expect(await autoriserConnexion({ email: '', password: 'x' }, req)).toBeNull()
    expect(mocks.reserver).not.toHaveBeenCalled()
  })

  it('compte inexistant : calcule le faux hachage puis enregistre l’échec', async () => {
    mocks.findFirst.mockResolvedValue(null)
    expect(await autoriserConnexion(creds, req)).toBeNull()
    expect(mocks.faux).toHaveBeenCalledWith('mot-de-passe-12')
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.reserver).toHaveBeenCalledWith({ email: 'jeanne@example.fr', ip: '1.2.3.4' })
    expect(mocks.reinitialiser).not.toHaveBeenCalled()
  })

  it('blocage : lève trop_de_tentatives sans aucun hachage ni recherche', async () => {
    mocks.reserver.mockResolvedValue(false)
    await expect(autoriserConnexion(creds, req)).rejects.toThrow(new Error('trop_de_tentatives'))
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.faux).not.toHaveBeenCalled()
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.hash).not.toHaveBeenCalled()
  })

  it('mauvais mot de passe : enregistre l’échec et renvoie null', async () => {
    mocks.findFirst.mockResolvedValue(utilisateur)
    mocks.verify.mockResolvedValue(false)
    expect(await autoriserConnexion(creds, req)).toBeNull()
    expect(mocks.reserver).toHaveBeenCalledTimes(1)
    expect(mocks.reinitialiser).not.toHaveBeenCalled()
  })

  it('succès avec ancien hash : réinitialise et met à jour passwordHash', async () => {
    mocks.findFirst.mockResolvedValue(utilisateur)
    mocks.verify.mockResolvedValue(true)
    mocks.rehacher.mockReturnValue(true)
    mocks.hash.mockResolvedValue('scrypt$nouveau')
    expect(await autoriserConnexion(creds, req)).toMatchObject({ id: 'u1', email: 'jeanne@example.fr', name: 'Jeanne D' })
    expect(mocks.reinitialiser).toHaveBeenCalledWith({ email: 'jeanne@example.fr', ip: '1.2.3.4' })
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { passwordHash: 'scrypt$nouveau' } })
  })

  it('une erreur de rehachage n’empêche pas la connexion', async () => {
    mocks.findFirst.mockResolvedValue(utilisateur)
    mocks.verify.mockResolvedValue(true)
    mocks.rehacher.mockReturnValue(true)
    mocks.hash.mockRejectedValue(new Error('boom'))
    expect(await autoriserConnexion(creds, req)).toMatchObject({ id: 'u1' })
  })

  it('hash à jour : aucun rehachage', async () => {
    mocks.findFirst.mockResolvedValue(utilisateur)
    mocks.verify.mockResolvedValue(true)
    mocks.rehacher.mockReturnValue(false)
    await autoriserConnexion(creds, req)
    expect(mocks.hash).not.toHaveBeenCalled()
  })

  it('sans proxy de confiance : l’IP forgée est ignorée, limite par e-mail seule', async () => {
    delete process.env.DATAGENIUS_PROXY_DE_CONFIANCE
    try {
      mocks.findFirst.mockResolvedValue(null)
      await autoriserConnexion(creds, { headers: { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '6.6.6.6' } })
      expect(mocks.reserver).toHaveBeenCalledWith({ email: 'jeanne@example.fr', ip: undefined })
    } finally {
      process.env.DATAGENIUS_PROXY_DE_CONFIANCE = '1'
    }
  })
})
