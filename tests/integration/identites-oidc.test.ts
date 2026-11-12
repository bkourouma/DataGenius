import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db/client'
import { configurationOidc, fournisseurOidc, lierIdentiteOidc, trouverUtilisateurOidc } from '@/lib/auth/oidc'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Identités OpenID Connect', () => {
  afterAll(() => prisma.$disconnect())

  it('lie un sujet à un seul compte actif et retire les accès après révocation', async () => {
    const emetteur = 'https://identite.example.test/' + randomUUID()
    const config = configurationOidc({ DATAGENIUS_OIDC_ISSUER: emetteur, DATAGENIUS_OIDC_CLIENT_ID: 'dg',
      DATAGENIUS_OIDC_CLIENT_SECRET: 'fixture' })!
    const fournisseur = fournisseurOidc(config)
    expect(fournisseur.checks).toEqual(['pkce', 'state', 'nonce'])
    expect(() => fournisseur.profile?.({ sub: 'identite-A', iss: 'https://autre.example.test' }, {}))
      .toThrow('Identité OpenID Connect invalide')
    const comptes = await Promise.all(['A', 'B'].map(suffixe => prisma.user.create({ data: {
      email: `${randomUUID()}-${suffixe}@example.test`, passwordHash: 'fixture', firstName: suffixe,
    } })))
    try {
      const [lie, autre] = comptes
      await expect(trouverUtilisateurOidc(emetteur, 'identite-A')).resolves.toBeNull()
      await lierIdentiteOidc(emetteur, 'identite-A', lie.email)
      await lierIdentiteOidc(emetteur, 'identite-A', lie.email)
      await expect(lierIdentiteOidc(emetteur, 'identite-A', autre.email)).rejects.toThrow('sujet déjà attribué')
      await expect(trouverUtilisateurOidc(emetteur, 'identite-A')).resolves.toMatchObject({ id: lie.id, roleName: 'Member' })
      vi.stubEnv('DATAGENIUS_OIDC_ISSUER', emetteur)
      vi.stubEnv('DATAGENIUS_OIDC_CLIENT_ID', 'dg')
      vi.stubEnv('DATAGENIUS_OIDC_CLIENT_SECRET', 'fixture')
      const { authOptions } = await import('@/lib/auth/config')
      const compte = { provider: 'entreprise', type: 'oauth' as const, providerAccountId: 'identite-A' }
      const utilisateur = { id: 'identite-A', roleName: 'Member' }
      await expect(authOptions.callbacks?.signIn?.({ user: utilisateur, account: compte })).resolves.toBe(true)
      const jeton = await authOptions.callbacks?.jwt?.({ token: { sub: 'identite-A', roleName: 'Member' }, user: utilisateur, account: compte })
      expect(jeton?.sub).toBe(lie.id)
      await prisma.$executeRaw`DELETE FROM public.identites_oidc WHERE emetteur = ${emetteur} AND sujet = 'identite-A'`
      await expect(authOptions.callbacks?.signIn?.({ user: utilisateur, account: compte })).resolves.toBe(false)
      await expect(authOptions.callbacks?.jwt?.({ token: jeton!, user: utilisateur, account: null })).resolves.toMatchObject({ sub: '' })
    } finally {
      vi.unstubAllEnvs()
      await prisma.user.deleteMany({ where: { id: { in: comptes.map(compte => compte.id) } } })
    }
  })
})
