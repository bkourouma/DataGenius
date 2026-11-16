import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { lookup, request, demandes, scenario } = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
  demandes: [] as { options: Record<string, unknown>; corps: string }[],
  scenario: { statut: 200 as number | 'reseau' | 'silence' },
}))

vi.mock('node:dns/promises', () => ({ lookup, default: { lookup } }))
vi.mock('node:https', () => ({ request, default: { request } }))

import { envoyerWebhook } from '@/lib/notifications/webhook'

const URL_PUBLIQUE = 'https://hooks.example.org/alerte?cle=secrete'

const sorties: unknown[][] = []

beforeEach(() => {
  sorties.length = 0
  for (const niveau of ['info', 'warn', 'error', 'log'] as const) vi.spyOn(console, niveau).mockImplementation((...args) => { sorties.push(args) })
  demandes.length = 0
  scenario.statut = 200
  lookup.mockReset()
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  request.mockReset()
  request.mockImplementation((options: Record<string, unknown>, rappel: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: (corps: string) => void }
    req.end = corps => {
      demandes.push({ options, corps })
      queueMicrotask(() => {
        if (scenario.statut === 'reseau') req.emit('error', new Error('ECONNRESET hooks.example.org'))
        else if (scenario.statut !== 'silence') rappel({ statusCode: scenario.statut, destroy: vi.fn() })
      })
    }
    return req
  })
})
afterEach(() => vi.restoreAllMocks())

describe('envoyerWebhook', () => {
  it.each([
    ['http://', 'http://hooks.example.org/a'],
    ['port explicite', 'https://hooks.example.org:8443/a'],
    ['identifiants', 'https://u:p@hooks.example.org/a'],
    ['fragment', 'https://hooks.example.org/a#x'],
    ['adresse illisible', 'pas une adresse'],
    ['localhost', 'https://localhost/a'],
    ['sous-domaine localhost', 'https://api.localhost/a'],
    ['127.0.0.1', 'https://127.0.0.1/a'],
    ['10.x', 'https://10.1.2.3/a'],
    ['métadonnées cloud', 'https://169.254.169.254/latest'],
    ['[::1]', 'https://[::1]/a'],
  ])('refuse %s sans émettre de requête', async (_, adresse) => {
    expect(await envoyerWebhook(adresse, {})).toEqual({ ok: false, raison: 'refuse' })
    expect(request).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('refuse un nom qui résout vers une adresse privée', async () => {
    lookup.mockResolvedValue([{ address: '192.168.0.12', family: 4 }])
    expect(await envoyerWebhook(URL_PUBLIQUE, {})).toEqual({ ok: false, raison: 'refuse' })
    expect(request).not.toHaveBeenCalled()
  })

  it('refuse un nom dont une des adresses est privée ou IPv6 interne', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.8', family: 4 }])
    expect(await envoyerWebhook(URL_PUBLIQUE, {})).toEqual({ ok: false, raison: 'refuse' })
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: 'fd00::1', family: 6 }])
    expect(await envoyerWebhook(URL_PUBLIQUE, {})).toEqual({ ok: false, raison: 'refuse' })
    expect(request).not.toHaveBeenCalled()
  })

  it('refuse sans exception d’origine privée', async () => {
    vi.stubEnv('DATAGENIUS_REST_ORIGINES_PRIVEES', 'https://hooks.example.org')
    vi.stubEnv('DATAGENIUS_SOURCES_HOTES_AUTORISES', 'hooks.example.org,10.0.0.8')
    lookup.mockResolvedValue([{ address: '10.0.0.8', family: 4 }])
    expect(await envoyerWebhook(URL_PUBLIQUE, {})).toEqual({ ok: false, raison: 'refuse' })
    expect(request).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('envoie en POST sur l’adresse résolue avec SNI et en-tête host', async () => {
    const charge = { evenement: 'tableau_alerte' }
    expect(await envoyerWebhook(URL_PUBLIQUE, charge)).toEqual({ ok: true })
    expect(lookup).toHaveBeenCalledWith('hooks.example.org', { all: true })
    expect(demandes).toHaveLength(1)
    const { options, corps } = demandes[0]
    expect(options).toMatchObject({
      hostname: '93.184.216.34', servername: 'hooks.example.org', method: 'POST', agent: false,
      path: '/alerte?cle=secrete', headers: expect.objectContaining({ host: 'hooks.example.org', 'content-type': 'application/json' }),
    })
    expect(options.port).toBeUndefined()
    expect(typeof options.checkServerIdentity).toBe('function')
    expect(JSON.parse(corps)).toEqual(charge)
  })

  it('traduit un statut hors 2xx, une erreur réseau et un délai dépassé', async () => {
    scenario.statut = 500
    expect(await envoyerWebhook(URL_PUBLIQUE, {})).toEqual({ ok: false, raison: 'statut' })
    scenario.statut = 302
    expect(await envoyerWebhook(URL_PUBLIQUE, {})).toEqual({ ok: false, raison: 'statut' })
    scenario.statut = 'reseau'
    expect(await envoyerWebhook(URL_PUBLIQUE, {})).toEqual({ ok: false, raison: 'reseau' })
    expect(request).toHaveBeenCalledTimes(3)

    scenario.statut = 'silence'
    const controle = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controle.signal)
    const attente = envoyerWebhook(URL_PUBLIQUE, {})
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4))
    controle.abort()
    expect(await attente).toEqual({ ok: false, raison: 'delai' })
  })

  it('ne journalise jamais l’adresse ni l’hôte', async () => {
    scenario.statut = 500
    await envoyerWebhook(URL_PUBLIQUE, {})
    scenario.statut = 'reseau'
    await envoyerWebhook(URL_PUBLIQUE, {})
    await envoyerWebhook('http://hooks.example.org/a?cle=secrete', {})
    lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }])
    await envoyerWebhook(URL_PUBLIQUE, {})
    expect(sorties.length).toBe(4)
    const texte = JSON.stringify(sorties)
    expect(texte).not.toContain('example.org')
    expect(texte).not.toContain('secrete')
    expect(texte).toContain('alertes_tableaux')
  })
})
