import { beforeEach, describe, expect, it, vi } from 'vitest'

const garde = vi.hoisted(() => ({ exigerMedicAssist: vi.fn() }))
vi.mock('@/lib/medic-assist/acces', () => garde)

const tableaux = vi.hoisted(() => {
  class ErreurTableau extends Error {}
  class ErreurVersionIncompatible extends ErreurTableau {}
  return {
    ErreurTableau,
    ErreurVersionIncompatible,
    restaurerVersion: vi.fn(),
    dupliquerTableau: vi.fn(),
    enregistrerTableau: vi.fn(),
    supprimerTableau: vi.fn(),
  }
})
vi.mock('@/lib/warehouse/tableaux', () => tableaux)

const journalMock = vi.hoisted(() => ({ journal: { erreur: vi.fn() } }))
vi.mock('@/lib/journal', () => journalMock)

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => cache)

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
}))
vi.mock('next/navigation', () => navigation)

const intl = vi.hoisted(() => ({
  getTranslations: vi.fn(async (_espace: string) => (cle: string) => `traduit:${cle}`),
}))
vi.mock('next-intl/server', () => intl)

vi.mock('@/lib/audit/enregistrer', () => ({ enregistrerAudit: vi.fn(async () => undefined) }))
vi.mock('@/app/(dashboard)/tableaux/erreurs-lib', () => ({ messageErreurTableau: async (message: string) => message }))

import { restaurer } from '@/app/(dashboard)/tableaux/actions'

function formulaire(champs: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(champs)) f.set(k, v)
  return f
}

const valide = { id: 'tab-1', version: '2', versionCourante: '5' }

beforeEach(() => {
  vi.clearAllMocks()
  garde.exigerMedicAssist.mockResolvedValue({ ok: true, contexte: { userId: 'u1' } })
  tableaux.restaurerVersion.mockResolvedValue('tab-1')
})

describe('action restaurer', () => {
  it('refuse sans session', async () => {
    garde.exigerMedicAssist.mockResolvedValue({ ok: false })
    const etat = await restaurer({}, formulaire(valide))
    expect(etat.erreur).toBeTruthy()
    expect(tableaux.restaurerVersion).not.toHaveBeenCalled()
  })

  it.each([
    ['id manquant', { version: '2', versionCourante: '5' }],
    ['id trop long', { ...valide, id: 'x'.repeat(65) }],
    ['version non numérique', { ...valide, version: 'abc' }],
    ['version décimale', { ...valide, version: '1.5' }],
    ['version nulle', { ...valide, version: '0' }],
    ['version courante absente', { id: 'tab-1', version: '2' }],
    ['version courante négative', { ...valide, versionCourante: '-3' }],
  ])('refuse les champs invalides : %s', async (_nom, champs) => {
    const etat = await restaurer({}, formulaire(champs))
    expect(etat.erreur).toBeTruthy()
    expect(tableaux.restaurerVersion).not.toHaveBeenCalled()
  })

  it('renvoie le message d’une ErreurTableau', async () => {
    tableaux.restaurerVersion.mockRejectedValue(new tableaux.ErreurTableau('Le tableau a changé.'))
    const etat = await restaurer({}, formulaire(valide))
    expect(etat).toEqual({ erreur: 'Le tableau a changé.' })
    expect(navigation.redirect).not.toHaveBeenCalled()
  })

  it('traduit l’erreur de version incompatible', async () => {
    tableaux.restaurerVersion.mockRejectedValue(new tableaux.ErreurVersionIncompatible('brut'))
    const etat = await restaurer({}, formulaire(valide))
    expect(intl.getTranslations).toHaveBeenCalledWith('historique')
    expect(etat).toEqual({ erreur: 'traduit:erreurIncompatible' })
  })

  it('renvoie un message générique traduit pour une erreur inattendue', async () => {
    tableaux.restaurerVersion.mockRejectedValue(new Error('boom base de données'))
    const etat = await restaurer({}, formulaire(valide))
    expect(etat).toEqual({ erreur: 'traduit:erreurGenerique' })
    expect(journalMock.journal.erreur).toHaveBeenCalledTimes(1)
    expect(journalMock.journal.erreur).toHaveBeenCalledWith(expect.any(String), { domaine: 'tableaux', erreur: 'Error' })
    expect(JSON.stringify(journalMock.journal.erreur.mock.calls)).not.toContain('boom')
  })

  it('ne journalise pas les erreurs métier attendues', async () => {
    tableaux.restaurerVersion.mockRejectedValue(new tableaux.ErreurTableau('Le tableau a changé.'))
    await restaurer({}, formulaire(valide))
    tableaux.restaurerVersion.mockRejectedValue(new tableaux.ErreurVersionIncompatible('brut'))
    await restaurer({}, formulaire(valide))
    expect(journalMock.journal.erreur).not.toHaveBeenCalled()
  })

  it('succès : revalide les pages puis redirige vers le tableau', async () => {
    await expect(restaurer({}, formulaire(valide))).rejects.toThrow('REDIRECT:/tableaux/tab-1')
    expect(tableaux.restaurerVersion).toHaveBeenCalledWith({ userId: 'u1' }, 'tab-1', 2, 5)
    expect(cache.revalidatePath.mock.calls.map(c => c[0])).toEqual([
      '/tableaux', '/tableaux/tab-1', '/tableaux/tab-1/historique',
    ])
  })
})
