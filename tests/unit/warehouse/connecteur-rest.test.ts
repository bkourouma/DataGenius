import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ConnexionRest, rest, testerRest } from '@/lib/warehouse/connecteurs/rest'
import type { JeuConfigure } from '@/lib/warehouse/configuration'

let origine: string
const acces: string[] = []
const serveur = createServer((req, res) => {
  acces.push(req.url ?? '')
  if (req.url === '/redirect') { res.writeHead(302, { Location: '/cible' }); res.end(); return }
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/gros') { res.end(' '.repeat(2 * 1024 * 1024 + 1)); return }
  if (req.headers.authorization !== 'Bearer cle-fictive') { res.writeHead(401); res.end(); return }
  res.end(req.url === '/items?page=1' ? '{"items":[{"identifiant":9007199254740993.25}]}' :
    req.url === '/items?page=2' ? '{"items":[{"identifiant":5}]}' : '{"items":[]}')
})

beforeAll(async () => {
  await new Promise<void>(resolve => serveur.listen(0, '127.0.0.1', resolve))
  origine = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`
})
afterEach(() => { vi.unstubAllEnvs(); acces.length = 0 })
afterAll(async () => { await new Promise<void>((resolve, reject) => serveur.close(err => err ? reject(err) : resolve())) })

describe('Connecteur REST', () => {
  it('découvre les colonnes, parcourt les pages et préserve les décimaux', async () => {
    vi.stubEnv('DATAGENIUS_REST_ORIGINES_PRIVEES', origine)
    const config = ConnexionRest.parse({ url: origine + '/items', token: 'cle-fictive', chemin: 'items', parametrePage: 'page' })
    const table = { schema: 'api', table: 'donnees' }
    expect(await rest.colonnes(config, table)).toEqual([{ nom: 'identifiant', type: 'decimal', typePostgres: 'nombre JSON' }])
    const jeu: JeuConfigure = { ...table, cle: 'recette', titre: 'Recette', description: 'Recette', grain: 'Une ligne par résultat',
      frequenceMinutes: 5, dimensions: [], mesures: [], colonnes: [{ nom: 'identifiant', description: 'Identifiant', type: 'decimal' }] }
    expect(await rest.lire(config, jeu)).toEqual({ lignes: 2, contenu: '[{"identifiant":"5"},{"identifiant":"9007199254740993.25"}]' })
    expect(acces).toEqual(['/items?page=1', '/items?page=1', '/items?page=2', '/items?page=3'])
  })

  it('refuse une origine privée non autorisée, les redirections et les pages trop grandes', async () => {
    vi.stubEnv('DATAGENIUS_REST_ORIGINES_PRIVEES', '')
    await expect(testerRest(ConnexionRest.parse({ url: origine }))).rejects.toThrow('indisponible')
    expect(acces).toEqual([])
    vi.stubEnv('DATAGENIUS_REST_ORIGINES_PRIVEES', origine)
    await expect(testerRest(ConnexionRest.parse({ url: origine + '/redirect' }))).rejects.toThrow('indisponible')
    await expect(testerRest(ConnexionRest.parse({ url: origine + '/gros' }))).rejects.toThrow('indisponible')
    expect(acces).toEqual(['/redirect', '/gros'])
    expect(ConnexionRest.safeParse({ url: 'https://u:p@example.com/' }).success).toBe(false)
    expect(ConnexionRest.safeParse({ url: 'adresse-invalide' }).success).toBe(false)
  })
})
