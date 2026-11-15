import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const queryRaw = vi.fn()
vi.mock('@/lib/db/client', () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}))

import { GET } from '@/app/api/health/route'

const ligneWorker = {
  hote: 'serveur1', version: '0.2.0', demarre_a: new Date(), dernier_signe_a: new Date(),
  intervalle_ms: 15_000, dernier_tour_a: null, dernier_tour_duree_ms: null,
  dernier_tour_jeux: null, dernier_tour_erreurs: null,
}

beforeEach(() => {
  queryRaw.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('GET /api/health', () => {
  it("200 quand la base répond, avec l'âge de synchronisation", async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]).mockResolvedValueOnce([{ age: 42.7 }])
      .mockResolvedValueOnce([{ ...ligneWorker, silence_ms: 12_345.6 }])
    const reponse = await GET()
    expect(reponse.status).toBe(200)
    expect(reponse.headers.get('Cache-Control')).toBe('no-store')
    expect(await reponse.json()).toEqual({
      statut: 'ok',
      base: 'ok',
      synchronisation: { ageSecondes: 42 },
      worker: { statut: 'marche', ageSecondes: 12 },
    })
  })

  it('503 quand la base est en erreur, sans fuite du message', async () => {
    queryRaw.mockRejectedValueOnce(
      Object.assign(new Error('postgres://u:secret@h'), { code: 'P1001' })
    )
    const reponse = await GET()
    expect(reponse.status).toBe(503)
    const corps = JSON.stringify(await reponse.json())
    expect(corps).not.toContain('secret')
    expect(JSON.parse(corps)).toMatchObject({ statut: 'degrade', base: 'ko' })
  })

  it('503 quand la base dépasse 2 secondes', async () => {
    vi.useFakeTimers()
    queryRaw.mockReturnValueOnce(new Promise(() => {}))
    const promesse = GET()
    await vi.advanceTimersByTimeAsync(2000)
    const reponse = await promesse
    expect(reponse.status).toBe(503)
    expect((await reponse.json()).base).toBe('ko')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('synchronisation null si la requête échoue, la route reste 200', async () => {
    queryRaw.mockResolvedValueOnce([{}]).mockRejectedValueOnce(new Error('relation absente'))
    const reponse = await GET()
    expect(reponse.status).toBe(200)
    expect((await reponse.json()).synchronisation).toEqual({ ageSecondes: null })
  })

  it('synchronisation null si la table est vide', async () => {
    queryRaw.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{ age: null }])
    expect((await (await GET()).json()).synchronisation.ageSecondes).toBeNull()
  })

  it('worker arrete : statut et âge en secondes, sans hôte ni version', async () => {
    queryRaw.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{ age: 1 }])
      .mockResolvedValueOnce([{ ...ligneWorker, silence_ms: 720_900 }])
    const reponse = await GET()
    expect(reponse.status).toBe(200)
    const corps = await reponse.json()
    expect(corps.worker).toEqual({ statut: 'arrete', ageSecondes: 720 })
    expect(JSON.stringify(corps)).not.toContain('serveur1')
    expect(JSON.stringify(corps)).not.toContain('0.2.0')
  })

  it('worker jamais vu : statut jamais_vu et âge null', async () => {
    queryRaw.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{ age: 1 }]).mockResolvedValueOnce([])
    expect((await (await GET()).json()).worker).toEqual({ statut: 'jamais_vu', ageSecondes: null })
  })

  it('worker : erreur de lecture donne null, la route reste 200', async () => {
    queryRaw.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{ age: 1 }])
      .mockRejectedValueOnce(new Error('relation absente'))
    const reponse = await GET()
    expect(reponse.status).toBe(200)
    expect((await reponse.json()).worker).toEqual({ statut: null, ageSecondes: null })
  })
})
