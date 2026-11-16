import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ executeRaw: vi.fn(), erreur: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ prisma: { $executeRaw: mocks.executeRaw } }))
vi.mock('@/lib/journal', () => ({ journal: { erreur: mocks.erreur, info: mocks.info, avertissement: vi.fn() } }))

// La limitation horaire vit dans une variable de module : on recharge le module à chaque test.
async function charger() {
  vi.resetModules()
  return import('@/lib/audit/purge')
}

describe('purgerJournalAudit', () => {
  beforeEach(() => {
    mocks.executeRaw.mockReset()
    mocks.erreur.mockReset()
    mocks.info.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('ne lève pas quand la base échoue et journalise l\'erreur (nom seulement)', async () => {
    mocks.executeRaw.mockRejectedValue(Object.assign(new Error('détail brut'), { name: 'PrismaClientInitializationError' }))
    const { purgerJournalAudit } = await charger()
    await expect(purgerJournalAudit({ forcer: true })).resolves.toBeUndefined()
    expect(mocks.erreur).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mocks.erreur.mock.calls)).not.toContain('détail brut')
  })

  it('journalise le nombre purgé en info s\'il est > 0, rien sinon', async () => {
    const { purgerJournalAudit } = await charger()
    mocks.executeRaw.mockResolvedValueOnce(0)
    await purgerJournalAudit({ forcer: true })
    expect(mocks.info).not.toHaveBeenCalled()
    mocks.executeRaw.mockResolvedValueOnce(7)
    await purgerJournalAudit({ forcer: true })
    expect(mocks.info).toHaveBeenCalledWith('Purge du journal d\'audit', { domaine: 'audit', supprimees: 7 })
  })

  it('sans forcer : au plus une purge par heure', async () => {
    mocks.executeRaw.mockResolvedValue(0)
    const { purgerJournalAudit } = await charger()
    await purgerJournalAudit()
    await purgerJournalAudit()
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-11-15T10:59:00Z'))
    await purgerJournalAudit()
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-11-15T11:01:00Z'))
    await purgerJournalAudit()
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2)
  })

  it('forcer ignore la limitation horaire', async () => {
    mocks.executeRaw.mockResolvedValue(0)
    const { purgerJournalAudit } = await charger()
    await purgerJournalAudit()
    await purgerJournalAudit({ forcer: true })
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2)
  })
})
