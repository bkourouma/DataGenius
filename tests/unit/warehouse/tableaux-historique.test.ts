import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), transaction: vi.fn() }))

vi.mock('@/lib/db/client', () => ({ prisma: { $queryRaw: mocks.queryRaw, $transaction: mocks.transaction, $executeRaw: vi.fn() } }))
vi.mock('@/lib/medic-assist/artefacts/stockage', () => ({ lireArtefact: vi.fn() }))
vi.mock('@/lib/medic-assist/donnees/catalogue/autorisation', () => ({ registreAutorise: vi.fn(async () => []) }))
vi.mock('@/lib/medic-assist/donnees/catalogue/registre', () => ({ registrePostgres: vi.fn() }))
vi.mock('@/lib/medic-assist/donnees/moteur/calculer', () => ({ calculerSemantique: vi.fn() }))
vi.mock('@/lib/medic-assist/suivi/comptes', () => ({ chargerComptesAvecAcces: vi.fn(async () => []) }))

import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { ErreurTableau, ErreurVersionIncompatible, restaurerVersion } from '@/lib/warehouse/tableaux'
import { resumerChangements } from '@/lib/warehouse/tableaux-historique'
import type { DefinitionTableau } from '@/lib/warehouse/tableaux-modeles'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const ID = '33333333-3333-4333-8333-333333333333'
const tuile = (id: string, mesure = 'ca_eur') => ({ id, type: 'mesure' as const, jeu: 'ventes', mesure, dimensions: [] as string[] })
const def = (p: Partial<DefinitionTableau> = {}): DefinitionTableau => ({ titre: 'T', lecteurs: [], tuiles: [tuile(A)], ...p })
const contexte = { userId: 'u1', locale: 'fr' } as unknown as ContexteExecution

describe('resumerChangements', () => {
  it('compte toutes les tuiles ajoutées pour la version initiale', () => {
    expect(resumerChangements(null, def({ tuiles: [tuile(A), tuile(B)], lecteurs: ['x'] })))
      .toEqual({ ajoutees: 2, retirees: 0, modifiees: 0, titreModifie: false, lecteursModifies: false })
  })
  it('détecte ajout, retrait et modification', () => {
    expect(resumerChangements(def({ tuiles: [tuile(A)] }), def({ tuiles: [tuile(B)] })))
      .toMatchObject({ ajoutees: 1, retirees: 1, modifiees: 0 })
    expect(resumerChangements(def(), def({ tuiles: [tuile(A, 'autre')] }))).toMatchObject({ ajoutees: 0, retirees: 0, modifiees: 1 })
  })
  it('détecte le titre et les lecteurs comme ensembles', () => {
    expect(resumerChangements(def(), def({ titre: 'U' })).titreModifie).toBe(true)
    expect(resumerChangements(def({ lecteurs: ['a', 'b'] }), def({ lecteurs: ['b', 'a'] })).lecteursModifies).toBe(false)
    expect(resumerChangements(def({ lecteurs: ['a'] }), def({ lecteurs: ['a', 'b'] })).lecteursModifies).toBe(true)
  })
  it('ignore l’ordre des clés', () => {
    const t = tuile(A)
    const inverse = Object.fromEntries(Object.entries(t).reverse()) as typeof t
    expect(resumerChangements(def({ tuiles: [t] }), def({ tuiles: [inverse] })).modifiees).toBe(0)
  })
})

describe('restaurerVersion', () => {
  beforeEach(() => mocks.queryRaw.mockReset())
  const courante = { version: 3, definition: def(), datee: new Date(), auteur: 'Moi' }
  const lecture = (archivees: unknown[], accessible = true) => {
    mocks.queryRaw.mockResolvedValueOnce(accessible ? [courante] : []).mockResolvedValueOnce(archivees)
  }
  const archive = (version: number, definition: unknown) => ({ version, definition, datee: new Date(), auteur: null })

  it('refuse un lecteur non propriétaire', async () => {
    lecture([], false)
    await expect(restaurerVersion(contexte, ID, 1, 3)).rejects.toThrow('Tableau indisponible.')
  })
  it('refuse la version courante', async () => {
    lecture([])
    await expect(restaurerVersion(contexte, ID, 3, 3)).rejects.toThrow('Cette version est déjà la version actuelle.')
  })
  it('refuse une version inconnue', async () => {
    lecture([])
    await expect(restaurerVersion(contexte, ID, 1, 3)).rejects.toThrow('Version introuvable.')
  })
  it('lève ErreurVersionIncompatible pour une définition archivée invalide', async () => {
    lecture([archive(2, def({ titre: '' }))])
    const e = await restaurerVersion(contexte, ID, 2, 3).catch(x => x)
    expect(e).toBeInstanceOf(ErreurVersionIncompatible)
    expect(e).toBeInstanceOf(ErreurTableau)
    lecture([archive(1, { ...def(), tuiles: [{ ...tuile(A), inconnu: 1 }] })])
    await expect(restaurerVersion(contexte, ID, 1, 3)).rejects.toBeInstanceOf(ErreurVersionIncompatible)
  })
  it('rejette un identifiant ou une version invalides', async () => {
    await expect(restaurerVersion(contexte, 'x', 1, 3)).rejects.toThrow('Tableau indisponible.')
    await expect(restaurerVersion(contexte, ID, 0, 3)).rejects.toThrow('Tableau indisponible.')
  })
})
