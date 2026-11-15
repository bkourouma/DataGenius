import { beforeEach, describe, expect, it, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  assistantMessage: { count: vi.fn() },
  user: { count: vi.fn() },
  parametreApplication: { findUnique: vi.fn() },
}))
vi.mock('@/lib/db/client', () => ({ prisma }))
const registreAutorise = vi.hoisted(() => vi.fn())
vi.mock('@/lib/medic-assist/donnees/catalogue/autorisation', () => ({ registreAutorise }))

import {
  calculerAffichage,
  cleMasquageDemarrage,
  etatDemarrage,
  type EtapeDemarrage,
  type EtatDemarrage,
} from '@/lib/medic-assist/demarrage'

const etapes = (faits: boolean[]): EtapeDemarrage[] =>
  (['source', 'import', 'catalogue', 'question', 'collegue'] as const).map((cle, i) => ({
    cle,
    fait: faits[i],
    href: null,
  }))
const admin = (faits: boolean[], masque = false): EtatDemarrage => ({
  role: 'admin',
  etapes: etapes(faits),
  masque,
  nbJeux: 0,
})

describe('calculerAffichage', () => {
  it('admin partiel : guide', () => {
    expect(calculerAffichage(admin([true, false, false, false, false]))).toBe('admin')
  })
  it('admin complet : rien', () => {
    expect(calculerAffichage(admin([true, true, true, true, true]))).toBeNull()
  })
  it('admin masque : rien', () => {
    expect(calculerAffichage(admin([false, false, false, false, false], true))).toBeNull()
  })
  it('membre sans jeu : message, avec jeu : rien', () => {
    expect(calculerAffichage({ role: 'membre', etapes: [], masque: false, nbJeux: 0 })).toBe('membre-sans-jeu')
    expect(calculerAffichage({ role: 'membre', etapes: [], masque: false, nbJeux: 2 })).toBeNull()
  })
})

describe('etatDemarrage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('admin : etapes tirees des donnees reelles', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ ok: true }])
      .mockResolvedValueOnce([{ ok: false }])
      .mockResolvedValueOnce([{ ok: false }])
    prisma.assistantMessage.count.mockResolvedValue(3)
    prisma.user.count.mockResolvedValue(0)
    prisma.parametreApplication.findUnique.mockResolvedValue({ valeur: '1' })
    const etat = await etatDemarrage({ userId: 'u1', roleName: 'TenantAdmin' })
    expect(etat.role).toBe('admin')
    expect(etat.etapes.map((e) => [e.cle, e.fait])).toEqual([
      ['source', true],
      ['import', false],
      ['catalogue', false],
      ['question', true],
      ['collegue', false],
    ])
    expect(etat.masque).toBe(true)
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { id: { not: 'u1' }, deletedAt: null } })
    expect(prisma.assistantMessage.count).toHaveBeenCalledWith({
      where: { role: 'user', conversation: { userId: 'u1' } },
    })
    expect(prisma.parametreApplication.findUnique).toHaveBeenCalledWith({ where: { cle: cleMasquageDemarrage('u1') } })
  })

  it('membre : nombre de jeux accessibles', async () => {
    registreAutorise.mockResolvedValue([])
    const contexte = { userId: 'm1' } as never
    const etat = await etatDemarrage({ userId: 'm1', roleName: 'Member', contexte, admin: false })
    expect(etat).toMatchObject({ role: 'membre', nbJeux: 0 })
    expect(registreAutorise).toHaveBeenCalledWith(contexte)
  })
})
