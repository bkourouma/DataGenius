import { beforeEach, describe, expect, it, vi } from 'vitest'

type Ligne = {
  id: string; userId: string; type: string; title: string; message: string
  relatedEntityType: string | null; relatedEntityId: string | null
  channel: string; readAt: Date | null; createdAt: Date
}
type Appel = { where: Record<string, unknown>; take?: number; data?: Record<string, unknown> }

const donnees: Ligne[] = []
const session = vi.hoisted(() => ({ courante: { user: { id: 'u1' } } as { user: { id: string } } | null }))
const prismaMock = vi.hoisted(() => ({ notification: {} as Record<string, ReturnType<typeof vi.fn>> }))

vi.mock('@/lib/auth/utils', () => ({ getSession: async () => session.courante }))
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }))
vi.mock('@/lib/journal', () => ({ journal: { erreur: vi.fn(), info: vi.fn(), avertissement: vi.fn(), enfant: vi.fn() } }))

function correspond(ligne: Ligne, where: Record<string, unknown>) {
  return Object.entries(where).every(([cle, valeur]) => (ligne as unknown as Record<string, unknown>)[cle] === valeur)
}

prismaMock.notification.count = vi.fn(async ({ where }: Appel) => donnees.filter(l => correspond(l, where)).length)
prismaMock.notification.findMany = vi.fn(async ({ where, take }: Appel) =>
  donnees.filter(l => correspond(l, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take))
prismaMock.notification.findFirst = vi.fn(async ({ where }: Appel) => donnees.find(l => correspond(l, where)) ?? null)
prismaMock.notification.updateMany = vi.fn(async ({ where, data }: Appel) => {
  const cibles = donnees.filter(l => correspond(l, where))
  cibles.forEach(l => { Object.assign(l, data) })
  return { count: cibles.length }
})

import { GET } from '@/app/api/notifications/route'
import { POST } from '@/app/api/notifications/lu/route'

function ligne(id: string, userId: string, minute: number, extra: Partial<Ligne> = {}): Ligne {
  return {
    id, userId, type: 'tableau_alerte', title: `titre ${id}`, message: `message ${id}`,
    relatedEntityType: 'tableau', relatedEntityId: 'abc', channel: 'in_app', readAt: null,
    createdAt: new Date(Date.UTC(2026, 10, 15, 10, minute)), ...extra,
  }
}

function requeteGet(query = '') {
  return GET({ nextUrl: new URL(`http://localhost/api/notifications${query}`) } as never)
}

function requetePost(corps: unknown, type: string | null = 'application/json') {
  return POST(new Request('http://localhost/api/notifications/lu', {
    method: 'POST',
    headers: type ? { 'content-type': type } : {},
    body: typeof corps === 'string' ? corps : JSON.stringify(corps),
  }) as never)
}

beforeEach(() => {
  session.courante = { user: { id: 'u1' } }
  donnees.length = 0
  donnees.push(
    ligne('a1', 'u1', 1), ligne('a2', 'u1', 2, { readAt: new Date() }), ligne('a3', 'u1', 3),
    ligne('b1', 'u2', 4), ligne('b2', 'u2', 5),
    ligne('mail', 'u1', 6, { channel: 'email' })
  )
  vi.clearAllMocks()
})

describe('GET /api/notifications', () => {
  it('renvoie 401 sans session', async () => {
    session.courante = null
    expect((await requeteGet()).status).toBe(401)
  })

  it('ne renvoie que les notifications in_app de l’utilisateur de session', async () => {
    const reponse = await requeteGet()
    expect(reponse.headers.get('Cache-Control')).toBe('no-store')
    const { data } = await reponse.json()
    expect(data.notifications.map((n: { id: string }) => n.id)).toEqual(['a3', 'a2', 'a1'])
    expect(data.nonLues).toBe(2)
    expect(JSON.stringify(data)).not.toContain('b1')
    expect(data.notifications[0]).toMatchObject({ lue: false, lien: '/tableaux/abc', titre: 'titre a3' })
    const appels = [...prismaMock.notification.findMany.mock.calls, ...prismaMock.notification.count.mock.calls]
    expect(appels.length).toBeGreaterThan(0)
    for (const appel of appels) {
      expect((appel[0] as Appel).where).toMatchObject({ userId: 'u1', channel: 'in_app' })
    }
  })

  it('filtre sur l’utilisateur de session, pas sur un paramètre de requête', async () => {
    session.courante = { user: { id: 'u2' } }
    const { data } = await (await requeteGet('?userId=u1')).json()
    expect(data.notifications.map((n: { id: string }) => n.id)).toEqual(['b2', 'b1'])
  })

  it.each([['?limite=1', 1], ['?limite=500', 20], ['?limite=0', 1], ['?limite=abc', 10], ['', 10]])(
    'borne la limite %s à %i', async (query, attendu) => {
      await requeteGet(query)
      expect((prismaMock.notification.findMany.mock.calls[0][0] as Appel).take).toBe(attendu)
    })
})

describe('POST /api/notifications/lu', () => {
  it('renvoie 401 sans session', async () => {
    session.courante = null
    expect((await requetePost({ tous: true })).status).toBe(401)
  })

  it('marque seulement la notification de l’utilisateur', async () => {
    const reponse = await requetePost({ id: 'a1' })
    expect(reponse.status).toBe(200)
    expect((await reponse.json()).data.nonLues).toBe(1)
    expect(donnees.find(l => l.id === 'a1')?.readAt).not.toBeNull()
    expect(donnees.find(l => l.id === 'b1')?.readAt).toBeNull()
  })

  it('renvoie 404 sans rien modifier pour un id d’un autre utilisateur ou inconnu', async () => {
    const autre = await requetePost({ id: 'b1' })
    const inconnu = await requetePost({ id: 'zzz' })
    expect(autre.status).toBe(404)
    expect(inconnu.status).toBe(404)
    expect(await autre.json()).toEqual(await inconnu.json())
    expect(prismaMock.notification.updateMany).not.toHaveBeenCalled()
    expect(donnees.find(l => l.id === 'b1')?.readAt).toBeNull()
  })

  it('« tous » ne touche que l’utilisateur de session', async () => {
    const reponse = await requetePost({ tous: true })
    expect((await reponse.json()).data.nonLues).toBe(0)
    expect(donnees.filter(l => l.userId === 'u1' && l.channel === 'in_app').every(l => l.readAt)).toBe(true)
    expect(donnees.filter(l => l.userId === 'u2').every(l => l.readAt === null)).toBe(true)
    expect((prismaMock.notification.updateMany.mock.calls[0][0] as Appel).where).toMatchObject({ userId: 'u1' })
  })

  it('renvoie 415 sans application/json', async () => {
    expect((await requetePost({ tous: true }, 'text/plain')).status).toBe(415)
    expect((await requetePost({ tous: true }, null)).status).toBe(415)
    expect(prismaMock.notification.updateMany).not.toHaveBeenCalled()
  })

  it.each([['{pas du json'], [{}], [{ id: '' }], [{ tous: false }], [{ id: 'a1', tous: true }], [{ id: 'a1', autre: 1 }], [{ id: 5 }]])(
    'renvoie 400 pour le corps invalide %j', async corps => {
      expect((await requetePost(corps)).status).toBe(400)
      expect(prismaMock.notification.updateMany).not.toHaveBeenCalled()
    })
})
