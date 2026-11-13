import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErreurHoteSource, adresseRestreinte, hotesAutorises, verifierHoteSource } from '@/lib/warehouse/hotes-sources'

afterEach(() => vi.restoreAllMocks())

describe('adresseRestreinte', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '64:ff9b::a00:1', '2001:db8::1', 'fec0::1', 'feff::1', '64:ff9b:1::1', '::ffff:0:8.8.8.8', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', 'n’importe quoi',
  ])('refuse %s', ip => expect(adresseRestreinte(ip)).toBe(true))

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '192.169.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'accepte %s', ip => expect(adresseRestreinte(ip)).toBe(false))
})

describe('hotesAutorises', () => {
  it('normalise la liste', () => {
    expect([...hotesAutorises(' DB.Interne , [::1],,10.0.0.5 ')]).toEqual(['db.interne', '::1', '10.0.0.5'])
    expect(hotesAutorises(undefined).size).toBe(0)
  })
})

describe('verifierHoteSource', () => {
  const resoudre = (adresses: string[]) => vi.fn(async () => adresses)
  const aucun = new Set<string>()

  it('refuse une IP interne littérale et localhost sans autorisation', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(verifierHoteSource('127.0.0.1', { autorises: aucun })).rejects.toBeInstanceOf(ErreurHoteSource)
    await expect(verifierHoteSource('[::1]', { autorises: aucun })).rejects.toThrow('non autorisé')
    await expect(verifierHoteSource('169.254.169.254', { autorises: aucun })).rejects.toThrow()
    await expect(verifierHoteSource('localhost', { autorises: aucun, resoudre: resoudre(['127.0.0.1', '::1']) })).rejects.toThrow()
  })

  it('refuse un nom dont une adresse résolue est privée, ou introuvable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(verifierHoteSource('pg.example', { autorises: aucun, resoudre: resoudre(['8.8.8.8', '10.0.0.4']) })).rejects.toThrow()
    await expect(verifierHoteSource('pg.example', { autorises: aucun, resoudre: resoudre([]) })).rejects.toThrow()
    await expect(verifierHoteSource('pg.example', { autorises: aucun, resoudre: async () => { throw new Error('ENOTFOUND') } })).rejects.toThrow()
  })

  it('accepte un nom public', async () => {
    await expect(verifierHoteSource('pg.example', { autorises: aucun, resoudre: resoudre(['8.8.8.8', '2606:4700:4700::1111']) })).resolves.toBeUndefined()
  })

  it('accepte un hôte listé, par nom ou par IP, sans résoudre le nom', async () => {
    const dns = vi.fn(async () => ['10.0.0.9'])
    await expect(verifierHoteSource('DB.Interne', { autorises: hotesAutorises('db.interne'), resoudre: dns })).resolves.toBeUndefined()
    expect(dns).not.toHaveBeenCalled()
    await expect(verifierHoteSource('127.0.0.1', { autorises: hotesAutorises('127.0.0.1') })).resolves.toBeUndefined()
    await expect(verifierHoteSource('pg.example', { autorises: hotesAutorises('10.0.0.9'), resoudre: dns })).resolves.toBeUndefined()
  })

  it('lit la variable d’environnement par défaut', async () => {
    vi.stubEnv('DATAGENIUS_SOURCES_HOTES_AUTORISES', '127.0.0.1')
    await expect(verifierHoteSource('127.0.0.1')).resolves.toBeUndefined()
    vi.stubEnv('DATAGENIUS_SOURCES_HOTES_AUTORISES', '')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(verifierHoteSource('127.0.0.1')).rejects.toThrow()
    vi.unstubAllEnvs()
  })
})
