import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn(), verify: vi.fn(), faux: vi.fn() }))

vi.mock('@/lib/db/client', () => ({ prisma: { user: { findFirst: mocks.findFirst, update: mocks.update } } }))
vi.mock('@/lib/auth/oidc', () => ({
  configurationOidc: () => null, FOURNISSEUR_OIDC: 'oidc', fournisseurOidc: vi.fn(), trouverUtilisateurOidc: vi.fn(),
}))
vi.mock('@/lib/auth/password', () => ({
  verifierFauxMotDePasse: mocks.faux, verifyPassword: mocks.verify, hashPassword: vi.fn(), doitRehacher: () => false,
}))
// Le vrai limiteur, branché sur un stockage en mémoire atomique (comme l'upsert SQL).
vi.mock('@/lib/auth/limite-connexion', async () => {
  const reel = await vi.importActual<typeof import('@/lib/auth/limite-connexion')>('@/lib/auth/limite-connexion')
  const lignes = new Map<string, { echecs: number, debut: number, bloque: number | null }>()
  const duree = reel.FENETRE_MINUTES * 60_000
  const magasin = {
    async enregistrer(cle: string, seuil: number) {
      const now = Date.now()
      const l = lignes.get(cle)
      const n = l?.bloque != null && l.bloque > now ? l
        : !l || l.debut + duree <= now ? { echecs: 1, debut: now, bloque: null }
          : { echecs: l.echecs + 1, debut: l.debut, bloque: l.echecs + 1 > seuil ? now + duree : null }
      lignes.set(cle, n)
      return { echecs: n.echecs, bloqueJusqua: n.bloque ? new Date(n.bloque) : null }
    },
    async liberer() {},
    async supprimer(cle: string) { lignes.delete(cle) },
    async purger() {},
  }
  return {
    ...reel,
    reserverTentative: (cible: Parameters<typeof reel.reserverTentative>[0]) => reel.reserverTentative(cible, magasin),
    reinitialiser: (cible: Parameters<typeof reel.reinitialiser>[0]) => reel.reinitialiser(cible, magasin),
  }
})

import { autoriserConnexion } from '@/lib/auth/config'

describe('autoriserConnexion : requêtes simultanées', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.findFirst.mockResolvedValue({ id: 'u1', email: 'a@x.fr', firstName: 'A', lastName: null, roleName: 'Member', passwordHash: 'h' })
    mocks.verify.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(false), 5)))
  })

  it('20 requêtes simultanées pour un même e-mail : au plus 5 hachages, les autres lèvent trop_de_tentatives', async () => {
    const resultats = await Promise.allSettled(
      Array.from({ length: 20 }, () => autoriserConnexion({ email: 'a@x.fr', password: 'faux-mot-de-passe' })),
    )
    expect(mocks.verify.mock.calls.length).toBeLessThanOrEqual(5)
    const refus = resultats.filter(r => r.status === 'rejected')
    expect(refus).toHaveLength(15)
    expect(refus.every(r => (r as PromiseRejectedResult).reason.message === 'trop_de_tentatives')).toBe(true)
  })
})
