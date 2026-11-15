import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({ assistantUsage: { aggregate: vi.fn() } }))
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }))

import {
  debutDeJournee,
  finDeJournee,
  verifierQuotaJournalier,
} from '@/lib/medic-assist/agent/quota'

/** Decimal Prisma : seul toString() compte. */
const decimal = (v: string) => ({ toString: () => v })
const somme = (v: string | null) => ({ _sum: { coutUsd: v === null ? null : decimal(v) } })

beforeEach(() => vi.clearAllMocks())

describe('verifierQuotaJournalier', () => {
  const maintenant = new Date('2026-11-13T10:30:00Z') 

  it('plafond 0, négatif ou non fini : autorise sans requête base', async () => {
    for (const plafond of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await verifierQuotaJournalier('u1', plafond, maintenant)).toEqual({ autorise: true })
    }
    expect(prismaMock.assistantUsage.aggregate).not.toHaveBeenCalled()
  })

  it('sous le plafond : autorise, avec une seule requête agrégée depuis minuit', async () => {
    prismaMock.assistantUsage.aggregate.mockResolvedValue(somme('1.499999'))
    expect(await verifierQuotaJournalier('u1', 1.5, maintenant)).toEqual({ autorise: true })
    expect(prismaMock.assistantUsage.aggregate).toHaveBeenCalledTimes(1)
    expect(prismaMock.assistantUsage.aggregate).toHaveBeenCalledWith({
      where: { userId: 'u1', createdAt: { gte: new Date('2026-11-13T00:00:00Z') } },
      _sum: { coutUsd: true },
    })
  })

  it('aucune consommation (somme nulle) : autorise', async () => {
    prismaMock.assistantUsage.aggregate.mockResolvedValue(somme(null))
    expect(await verifierQuotaJournalier('u1', 2, maintenant)).toEqual({ autorise: true })
  })

  it('au plafond ou au-dessus : refuse avec le prochain minuit', async () => {
    prismaMock.assistantUsage.aggregate.mockResolvedValue(somme('2.000000'))
    const verdict = await verifierQuotaJournalier('u1', 2, maintenant)
    expect(verdict).toEqual({
      autorise: false,
      plafondUsd: 2,
      consommeUsd: 2,
      reinitialisationA: new Date('2026-11-14T00:00:00Z'),
    })
  })
})

describe('debutDeJournee / finDeJournee (minuit UTC)', () => {
  it('bascule à minuit UTC, pas à minuit Paris', () => {
    const avant = new Date('2026-11-13T23:59:59Z')
    const apres = new Date('2026-11-14T00:00:00Z')
    expect(debutDeJournee(avant)).toEqual(new Date('2026-11-13T00:00:00Z'))
    expect(finDeJournee(avant)).toEqual(new Date('2026-11-14T00:00:00Z'))
    expect(debutDeJournee(apres)).toEqual(new Date('2026-11-14T00:00:00Z'))
    expect(finDeJournee(apres)).toEqual(new Date('2026-11-15T00:00:00Z'))
  })

  it("pas de décalage aux changements d'heure de Paris (jours toujours de 24 h)", () => {
    for (const jour of ['2027-03-28T10:00:00Z', '2026-10-25T10:00:00Z']) {
      const d = new Date(jour)
      expect(finDeJournee(d).getTime() - debutDeJournee(d).getTime()).toBe(24 * 3600 * 1000)
    }
  })

  it('fin de mois et d’année', () => {
    expect(finDeJournee(new Date('2026-12-31T12:00:00Z'))).toEqual(new Date('2027-01-01T00:00:00Z'))
    expect(finDeJournee(new Date('2027-02-28T12:00:00Z'))).toEqual(new Date('2027-03-01T00:00:00Z'))
  })
})
