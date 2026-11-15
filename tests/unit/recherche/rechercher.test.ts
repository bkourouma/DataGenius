import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requeteBrute, listerGlossaire, ressourceDansPerimetre, erreur } = vi.hoisted(() => ({
  requeteBrute: vi.fn(),
  listerGlossaire: vi.fn(),
  ressourceDansPerimetre: vi.fn(),
  erreur: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ prisma: { $queryRaw: requeteBrute } }))
vi.mock('@/lib/glossaire/glossaire', () => ({ listerGlossaire }))
vi.mock('@/lib/journal', () => ({ journal: { info: vi.fn(), avertissement: vi.fn(), erreur } }))
vi.mock('@/lib/medic-assist/suivi/perimetre-ressource', () => ({ ressourceDansPerimetre }))

import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { LONGUEUR_MAX, LONGUEUR_MIN, rechercher, requeteValide } from '@/lib/recherche/rechercher'

const contexte = (roleName = 'Member') =>
  ({ userId: 'u1', roleName, scope: {} as never, habilitations: null, locale: 'fr', maintenant: new Date() }) as ContexteExecution

const lignes = (debut: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ racine: `r${debut + i}`, titre: `Analyse ${debut + i}`, description: null }))

/** Aiguille les appels SQL : les analyses sont reconnues à leur CTE « visibles ». */
function brancherSql(pagesAnalyses: unknown[][]) {
  let page = 0
  requeteBrute.mockImplementation(async (modele: TemplateStringsArray) => {
    if (modele.join('?').includes('visibles')) return pagesAnalyses[page++] ?? []
    return []
  })
  return () => page
}

const analyses = async () => (await rechercher(contexte(), 'revenu')).filter(r => r.type === 'analyse')

beforeEach(() => {
  vi.resetAllMocks()
  listerGlossaire.mockResolvedValue([])
  ressourceDansPerimetre.mockResolvedValue(true)
})

describe('requeteValide', () => {
  it('borne la requête entre 2 et 100 caractères, après trim', () => {
    expect(LONGUEUR_MIN).toBe(2)
    expect(LONGUEUR_MAX).toBe(100)
    expect(requeteValide('a')).toBeNull()
    expect(requeteValide('  a  ')).toBeNull()
    expect(requeteValide('ab')).toBe('ab')
    expect(requeteValide('  ab  ')).toBe('ab')
    expect(requeteValide('a'.repeat(100))).toBe('a'.repeat(100))
    expect(requeteValide('a'.repeat(101))).toBeNull()
    expect(requeteValide(`  ${'a'.repeat(100)}  `)).toBe('a'.repeat(100))
  })

  it('rechercher() ne touche à rien si la requête est invalide', async () => {
    expect(await rechercher(contexte(), 'a')).toEqual([])
    expect(await rechercher(contexte(), 'a'.repeat(101))).toEqual([])
    expect(requeteBrute).not.toHaveBeenCalled()
    expect(listerGlossaire).not.toHaveBeenCalled()
  })
})

describe('rechercher : isolement des erreurs', () => {
  it('un type en échec est vide, journalisé par son nom sans la requête, les autres types répondent', async () => {
    class PanneBase extends Error {
      constructor() {
        super('relation « secret » absente')
        this.name = 'PanneBase'
      }
    }
    requeteBrute.mockImplementation(async (modele: TemplateStringsArray) => {
      const sql = modele.join('?')
      if (sql.includes('warehouse.tableaux')) throw new PanneBase()
      if (sql.includes('visibles')) return [{ racine: 'r1', titre: 'Analyse revenu', description: 'note' }]
      if (sql.includes('warehouse.sources')) return [{ id: 's1', titre: 'Source revenu' }]
      return []
    })
    listerGlossaire.mockResolvedValue([
      { ancre: 'j-i', indicateur: { libelle: 'Revenu' }, jeu: { libelle: 'Ventes' } },
    ])
    const resultats = await rechercher(contexte('TenantAdmin'), 'revenu confidentiel')
    expect(resultats.map(r => r.type).sort()).toEqual(['analyse', 'glossaire', 'source'])
    expect(erreur).toHaveBeenCalledTimes(1)
    expect(erreur.mock.calls[0]![1]).toEqual({ domaine: 'recherche', type: 'tableau', erreur: 'PanneBase' })
    expect(JSON.stringify(erreur.mock.calls)).not.toContain('confidentiel')
    expect(JSON.stringify(erreur.mock.calls)).not.toContain('secret')
  })

  it('le glossaire en échec n’empêche pas les analyses', async () => {
    listerGlossaire.mockRejectedValue(new TypeError('x'))
    brancherSql([lignes(1, 2)])
    const resultats = await rechercher(contexte(), 'revenu')
    expect(resultats.filter(r => r.type === 'analyse')).toHaveLength(2)
    expect(erreur.mock.calls[0]![1]).toEqual({ domaine: 'recherche', type: 'glossaire', erreur: 'TypeError' })
  })
})

describe('rechercher : pagination des analyses', () => {
  it('lit une 2e page quand la 1re, pleine, est refusée par le périmètre', async () => {
    const page = brancherSql([lignes(0, 40), lignes(40, 3)])
    ressourceDansPerimetre.mockImplementation(async (_c: unknown, _t: string, id: string) => Number(id.slice(1)) >= 40)
    const resultats = await analyses()
    expect(page()).toBe(2)
    expect(resultats.map(r => r.id)).toEqual(['r40', 'r41', 'r42'])
  })

  it('s’arrête à 10 résultats sans lire la page suivante', async () => {
    const page = brancherSql([lignes(0, 40), lignes(40, 40)])
    const resultats = await analyses()
    expect(resultats).toHaveLength(10)
    expect(page()).toBe(1)
    expect(ressourceDansPerimetre).toHaveBeenCalledTimes(10)
  })

  it('s’arrête quand une page est incomplète', async () => {
    const page = brancherSql([lignes(0, 39), lignes(39, 40)])
    ressourceDansPerimetre.mockResolvedValue(false)
    expect(await analyses()).toEqual([])
    expect(page()).toBe(1)
  })

  it('lit au plus 5 pages de 40 lignes', async () => {
    const pages = Array.from({ length: 8 }, (_, i) => lignes(i * 40, 40))
    const page = brancherSql(pages)
    ressourceDansPerimetre.mockResolvedValue(false)
    expect(await analyses()).toEqual([])
    expect(page()).toBe(5)
    expect(ressourceDansPerimetre).toHaveBeenCalledTimes(200)
  })
})
