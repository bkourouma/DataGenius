import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cookieStore, getSession, prisma, journal, cookieLu } = vi.hoisted(() => ({
  cookieStore: { set: vi.fn(), get: vi.fn() },
  getSession: vi.fn(),
  prisma: { user: { update: vi.fn(), findUnique: vi.fn() } },
  journal: { erreur: vi.fn(), info: vi.fn(), avertissement: vi.fn(), enfant: vi.fn() },
  cookieLu: { valeur: undefined as string | undefined },
}))

vi.mock('next/headers', () => ({ cookies: () => cookieStore }))
vi.mock('@/lib/auth/utils', () => ({ getSession }))
vi.mock('@/lib/db/client', () => ({ prisma }))
vi.mock('@/lib/journal', () => ({ journal }))

import { appliquerLangueEnregistree, changerLangue } from '@/i18n/actions'
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, locales } from '@/i18n/config'

beforeEach(() => {
  cookieLu.valeur = undefined
  cookieStore.get.mockImplementation(() => (cookieLu.valeur === undefined ? undefined : { value: cookieLu.valeur }))
  getSession.mockResolvedValue({ user: { id: 'u1' } })
  prisma.user.update.mockResolvedValue({})
  prisma.user.findUnique.mockResolvedValue({ locale: 'fr' })
})

describe('changerLangue', () => {
  it.each([[''], ['xx'], ['FR'], ['../'], ['fr '], [undefined as unknown as string]])(
    'refuse %j sans cookie ni écriture en base',
    async (valeur) => {
      await expect(changerLangue(valeur)).resolves.toEqual({ ok: false })
      expect(cookieStore.set).not.toHaveBeenCalled()
      expect(getSession).not.toHaveBeenCalled()
      expect(prisma.user.update).not.toHaveBeenCalled()
    },
  )

  it.each(locales.map((l) => [l]))('accepte %s : cookie posé et profil mis à jour', async (langue) => {
    await expect(changerLangue(langue)).resolves.toEqual({ ok: true })
    expect(cookieStore.set).toHaveBeenCalledTimes(1)
    expect(cookieStore.set).toHaveBeenCalledWith(
      LOCALE_COOKIE,
      langue,
      expect.objectContaining({ path: '/', maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: 'lax', httpOnly: false }),
    )
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { locale: langue } })
  })

  it('cookie secure uniquement en production', async () => {
    const env = process.env as Record<string, string | undefined>
    const avant = env.NODE_ENV
    try {
      env.NODE_ENV = 'production'
      await changerLangue('en')
      expect(cookieStore.set.mock.calls[0][2]).toMatchObject({ secure: true })
      cookieStore.set.mockClear()
      env.NODE_ENV = 'test'
      await changerLangue('en')
      expect(cookieStore.set.mock.calls[0][2]).toMatchObject({ secure: false })
    } finally {
      env.NODE_ENV = avant
    }
  })

  it('sans session : cookie seul', async () => {
    getSession.mockResolvedValue(null)
    await expect(changerLangue('es')).resolves.toEqual({ ok: true })
    expect(cookieStore.set).toHaveBeenCalledTimes(1)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('échec de la base : cookie posé, ok:true et erreur journalisée sans donnée personnelle', async () => {
    prisma.user.update.mockRejectedValue(new Error('connexion a@x.fr refusée'))
    await expect(changerLangue('zh')).resolves.toEqual({ ok: true })
    expect(cookieStore.set).toHaveBeenCalledTimes(1)
    expect(journal.erreur).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(journal.erreur.mock.calls)).not.toMatch(/a@x\.fr|u1/)
  })
})

describe('appliquerLangueEnregistree', () => {
  it('ne fait rien si le cookie est déjà présent', async () => {
    cookieLu.valeur = 'en'
    await expect(appliquerLangueEnregistree()).resolves.toEqual({ ok: true })
    expect(getSession).not.toHaveBeenCalled()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(cookieStore.set).not.toHaveBeenCalled()
  })

  it('pose le cookie si absent et locale enregistrée valide différente du français', async () => {
    prisma.user.findUnique.mockResolvedValue({ locale: 'ar' })
    await expect(appliquerLangueEnregistree()).resolves.toEqual({ ok: true })
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { locale: true } })
    expect(cookieStore.set).toHaveBeenCalledWith(LOCALE_COOKIE, 'ar', expect.objectContaining({ path: '/', httpOnly: false }))
  })

  it.each([['fr'], ['xx'], [''], [null]])('ne pose rien pour la valeur enregistrée %j', async (valeur) => {
    prisma.user.findUnique.mockResolvedValue({ locale: valeur })
    await expect(appliquerLangueEnregistree()).resolves.toEqual({ ok: true })
    expect(cookieStore.set).not.toHaveBeenCalled()
  })

  it('sans session : rien', async () => {
    getSession.mockResolvedValue(null)
    await expect(appliquerLangueEnregistree()).resolves.toEqual({ ok: true })
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(cookieStore.set).not.toHaveBeenCalled()
  })

  it('échec de la base : ok:false et journal', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('base'))
    await expect(appliquerLangueEnregistree()).resolves.toEqual({ ok: false })
    expect(journal.erreur).toHaveBeenCalledTimes(1)
    expect(cookieStore.set).not.toHaveBeenCalled()
  })
})
