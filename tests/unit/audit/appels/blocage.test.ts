import { beforeEach, describe, expect, it } from 'vitest'
import { doitTracerBlocage, reinitialiserBlocages } from '@/lib/audit/blocage'

const FENETRE = 15 * 60_000

beforeEach(() => reinitialiserBlocages())

describe('doitTracerBlocage', () => {
  it('trace la première fois puis plus dans la fenêtre', () => {
    expect(doitTracerBlocage('a', 1000)).toBe(true)
    expect(doitTracerBlocage('a', 1001)).toBe(false)
    expect(doitTracerBlocage('a', 1000 + FENETRE - 1)).toBe(false)
  })

  it('les clés sont indépendantes', () => {
    expect(doitTracerBlocage('a', 1000)).toBe(true)
    expect(doitTracerBlocage('b', 1000)).toBe(true)
  })

  it('ré-autorise après la fenêtre, puis rouvre une fenêtre', () => {
    expect(doitTracerBlocage('a', 1000)).toBe(true)
    expect(doitTracerBlocage('a', 1000 + FENETRE)).toBe(true)
    expect(doitTracerBlocage('a', 1000 + FENETRE + 1)).toBe(false)
  })

  it('mémoire bornée : plus de 5000 clés distinctes sans plantage', () => {
    for (let i = 0; i < 6000; i++) expect(doitTracerBlocage('k' + i, 5000)).toBe(true)
    expect(doitTracerBlocage('nouvelle', 5000)).toBe(true)
    expect(doitTracerBlocage('nouvelle', 5001)).toBe(false)
  })

  it('purge les entrées expirées quand la table est pleine', () => {
    for (let i = 0; i < 5000; i++) doitTracerBlocage('k' + i, 0)
    expect(doitTracerBlocage('neuve', FENETRE + 1)).toBe(true)
    expect(doitTracerBlocage('k0', FENETRE + 2)).toBe(true)
  })
})
