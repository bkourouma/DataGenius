import { beforeEach, describe, expect, it, vi } from 'vitest'

const etat = vi.hoisted(() => ({
  type: 'invitation' as 'invitation' | 'reinitialisation',
  statut: 'invited',
  /** Nombre de lignes que l'activation conditionnelle met à jour (0 = état changé entre-temps). */
  lignesActivees: 1,
  activations: [] as unknown[],
  invalidations: 0,
}))

vi.mock('@/lib/db/client', () => {
  const tx = {
    compteJeton: {
      findUnique: vi.fn(async () => ({ id: 'j1', userId: 'u1', type: etat.type })),
      updateMany: vi.fn(async (arg: { data: { utiliseA: Date } }) => {
        if ('utiliseA' in arg.data && (arg as { where: { id?: string } }).where.id === 'j1') return { count: 1 }
        etat.invalidations += 1
        return { count: 0 }
      }),
    },
    user: {
      findUnique: vi.fn(async () => ({ id: 'u1', status: etat.statut, deletedAt: null })),
      updateMany: vi.fn(async (arg: unknown) => {
        etat.activations.push(arg)
        return { count: etat.lignesActivees }
      }),
    },
    $queryRaw: vi.fn(async () => []),
  }
  return { prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }
})
vi.mock('@/lib/mail/transport', () => ({ envoyerMail: vi.fn(async () => true), mailConfigure: () => true }))

import { ErreurComptes, definirMotDePasse } from '@/lib/auth/comptes'

const MOT_DE_PASSE = 'mot-de-passe-fictif-12'

beforeEach(() => {
  etat.type = 'invitation'
  etat.statut = 'invited'
  etat.lignesActivees = 1
  etat.activations = []
  etat.invalidations = 0
})

describe('definirMotDePasse : activation conditionnée à l’état attendu', () => {
  it('invitation : active seulement un compte encore « invited »', async () => {
    await definirMotDePasse('jeton-fictif', MOT_DE_PASSE)
    expect(etat.activations[0]).toMatchObject({ where: { id: 'u1', status: 'invited', deletedAt: null }, data: { status: 'active' } })
  })

  it('réinitialisation : active seulement un compte encore « active »', async () => {
    etat.type = 'reinitialisation'
    etat.statut = 'active'
    await definirMotDePasse('jeton-fictif', MOT_DE_PASSE)
    expect(etat.activations[0]).toMatchObject({ where: { id: 'u1', status: 'active', deletedAt: null } })
  })

  it('désactivation concurrente : aucune ligne mise à jour, lien invalide, rien d’autre n’est invalidé', async () => {
    etat.lignesActivees = 0
    await expect(definirMotDePasse('jeton-fictif', MOT_DE_PASSE)).rejects.toThrow('Ce lien est invalide')
    await expect(definirMotDePasse('jeton-fictif', MOT_DE_PASSE)).rejects.toBeInstanceOf(ErreurComptes)
    expect(etat.invalidations).toBe(0)
  })
})
