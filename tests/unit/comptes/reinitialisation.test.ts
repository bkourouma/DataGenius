import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const etat = vi.hoisted(() => ({
  compte: null as null | { id: string; email: string; firstName: string },
  oidc: false,
  recentes: 0,
  crees: [] as unknown[],
}))
const envoyerMail = vi.hoisted(() => vi.fn(async (_message: { text: string }) => true))

vi.mock('@/lib/db/client', () => {
  const tx = {
    user: { findFirst: vi.fn(async () => etat.compte) },
    $queryRaw: vi.fn(async (...args: unknown[]) => {
      const sql = (args[0] as readonly string[]).join('?')
      return sql.includes('identites_oidc') ? (etat.oidc ? [{ x: 1 }] : []) : [{}]
    }),
    compteJeton: {
      count: vi.fn(async () => etat.recentes),
      create: vi.fn(async (arg: unknown) => { etat.crees.push(arg) }),
    },
  }
  return { prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }
})
vi.mock('@/lib/mail/transport', () => ({ envoyerMail, mailConfigure: () => true }))

import { demanderReinitialisation } from '@/lib/auth/comptes'

const COMPTE = { id: 'u1', email: 'jean@example.test', firstName: 'Jean' }

beforeEach(() => {
  etat.compte = null
  etat.oidc = false
  etat.recentes = 0
  etat.crees = []
  envoyerMail.mockClear()
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3120')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('demanderReinitialisation', () => {
  it('répond de la même façon pour un compte inconnu et pour un compte existant', async () => {
    const inconnu = await demanderReinitialisation('personne@example.test')
    expect(etat.crees).toHaveLength(0)
    etat.compte = COMPTE
    const existant = await demanderReinitialisation('Jean@Example.test')
    expect(existant).toBe(inconnu)
    expect(existant).toBeUndefined()
    expect(etat.crees).toHaveLength(1)
  })

  it('ne lève jamais : e-mail invalide, URL absente', async () => {
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(demanderReinitialisation('nimporte quoi')).resolves.toBeUndefined()
    vi.stubEnv('NEXTAUTH_URL', '')
    vi.stubEnv('APP_URL', '')
    etat.compte = COMPTE
    await expect(demanderReinitialisation('jean@example.test')).resolves.toBeUndefined()
    expect(JSON.parse(erreur.mock.calls[0][0] as string)).toMatchObject({
      niveau: 'erreur', domaine: 'comptes', action: 'reinitialisation_url_absente',
    })
    expect(etat.crees).toHaveLength(0)
  })

  it('ne crée rien pour un compte OIDC ou après 3 demandes dans l’heure', async () => {
    etat.compte = COMPTE
    etat.oidc = true
    await demanderReinitialisation('jean@example.test')
    etat.oidc = false
    etat.recentes = 3
    await demanderReinitialisation('jean@example.test')
    expect(etat.crees).toHaveLength(0)
    expect(envoyerMail).not.toHaveBeenCalled()
  })

  it("n'écrit ni jeton ni lien ni e-mail dans les journaux, et ne stocke pas le jeton clair", async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    etat.compte = COMPTE
    await demanderReinitialisation('jean@example.test')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(envoyerMail).toHaveBeenCalledTimes(1)
    const jeton = /jeton=([\w-]+)/.exec(envoyerMail.mock.calls[0][0].text)![1]
    const journal = JSON.stringify([...info.mock.calls, ...erreur.mock.calls])
    expect(journal).not.toContain(jeton)
    expect(journal).not.toContain('jean@example.test')
    expect(journal).not.toContain('definir-mot-de-passe')
    expect(JSON.stringify(etat.crees)).not.toContain(jeton)
  })
})
