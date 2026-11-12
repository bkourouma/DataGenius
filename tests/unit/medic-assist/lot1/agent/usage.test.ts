import { describe, expect, it } from 'vitest'
import { UsageTokensSchema } from '@/lib/medic-assist/contrats'
import { additionnerUsages, normaliserUsage } from '@/lib/medic-assist/agent/usage'

// Marqueur de test : ZZMA1USAGE

const ZERO = { entree: 0, sortie: 0, cacheLecture: 0, cacheEcriture: 0, raisonnement: 0 }

describe('normaliserUsage', () => {
  it('lit la forme du SDK v7 : entrée = total des jetons d’entrée, cache compris', () => {
    expect(
      normaliserUsage({
        inputTokens: 1_000,
        outputTokens: 200,
        totalTokens: 1_200,
        inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100 },
        outputTokenDetails: { textTokens: 150, reasoningTokens: 50 },
      }),
    ).toEqual({ entree: 1_000, sortie: 200, cacheLecture: 800, cacheEcriture: 100, raisonnement: 50 })
  })

  it('produit un objet accepté par UsageTokensSchema', () => {
    const usage = normaliserUsage({ inputTokens: 10.4, outputTokens: 2 })
    expect(UsageTokensSchema.safeParse(usage).success).toBe(true)
  })

  it('traite les valeurs absentes comme 0', () => {
    expect(normaliserUsage({ inputTokens: 50 })).toEqual({ ...ZERO, entree: 50 })
    expect(normaliserUsage({})).toEqual(ZERO)
  })

  it('accepte undefined, null et les types inattendus sans jamais produire NaN', () => {
    for (const entree of [undefined, null, 42, 'x', [], () => 1]) {
      const usage = normaliserUsage(entree)
      for (const valeur of Object.values(usage)) expect(Number.isNaN(valeur)).toBe(false)
      expect(usage).toEqual(ZERO)
    }
    const usage = normaliserUsage({
      inputTokens: Number.NaN,
      outputTokens: Infinity,
      inputTokenDetails: { cacheReadTokens: 'abc', cacheWriteTokens: null },
    })
    expect(usage).toEqual(ZERO)
  })

  it('ne rend jamais une valeur négative', () => {
    expect(normaliserUsage({ inputTokens: -5, outputTokens: -1 })).toEqual(ZERO)
  })

  it('reconstitue le total quand il est absent (noCacheTokens + cache)', () => {
    expect(
      normaliserUsage({ inputTokenDetails: { noCacheTokens: 70, cacheReadTokens: 30 } }),
    ).toEqual({ ...ZERO, entree: 100, cacheLecture: 30 })
  })

  it('accepte les anciens noms de champs', () => {
    expect(
      normaliserUsage({ promptTokens: 300, completionTokens: 40, cachedInputTokens: 100 }),
    ).toEqual({ ...ZERO, entree: 300, sortie: 40, cacheLecture: 100 })
  })

  it('accepte des nombres sous forme de chaîne', () => {
    expect(normaliserUsage({ inputTokens: '12', outputTokens: '3' })).toMatchObject({
      entree: 12,
      sortie: 3,
    })
  })
})

describe('additionnerUsages', () => {
  const a = { entree: 1, sortie: 2, cacheLecture: 3, cacheEcriture: 4, raisonnement: 5 }
  const b = { entree: 10, sortie: 20, cacheLecture: 30, cacheEcriture: 40, raisonnement: 50 }

  it('additionne des arguments ou une liste', () => {
    const attendu = { entree: 11, sortie: 22, cacheLecture: 33, cacheEcriture: 44, raisonnement: 55 }
    expect(additionnerUsages(a, b)).toEqual(attendu)
    expect(additionnerUsages([a, b])).toEqual(attendu)
  })

  it('accepte des usages partiels du contrat (champs facultatifs absents)', () => {
    expect(additionnerUsages({ entree: 5, sortie: 1 }, { entree: 1, sortie: 1 })).toEqual({
      ...ZERO,
      entree: 6,
      sortie: 2,
    })
  })

  it('renvoie un usage vide sans argument et ne mute pas les entrées', () => {
    expect(additionnerUsages()).toEqual(ZERO)
    additionnerUsages(a, b)
    expect(a).toEqual({ entree: 1, sortie: 2, cacheLecture: 3, cacheEcriture: 4, raisonnement: 5 })
  })

  it('ignore les entrées nulles', () => {
    expect(additionnerUsages(a, null, undefined)).toEqual(a)
  })
})
