import { beforeEach, describe, expect, it, vi } from 'vitest'

const ordre = vi.hoisted(() => ({ appels: [] as string[] }))

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

const audit = vi.hoisted(() => ({ enregistrerAudit: vi.fn() }))
vi.mock('@/lib/audit/enregistrer', () => audit)

vi.mock('@/lib/journal', () => ({ journal: { erreur: vi.fn() } }))

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => cache)

const navigation = vi.hoisted(() => ({ redirect: vi.fn() }))
vi.mock('next/navigation', () => navigation)

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (_espace: string) => (cle: string) => `traduit:${cle}`),
}))
vi.mock('@/app/(dashboard)/tableaux/erreurs-lib', () => ({ messageErreurTableau: async (message: string) => message }))

import { dupliquer, restaurer, supprimer } from '@/app/(dashboard)/tableaux/actions'

function formulaire(champs: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(champs)) f.set(k, v)
  return f
}

const contexte = { userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  ordre.appels = []
  garde.exigerMedicAssist.mockResolvedValue({ ok: true, contexte })
  tableaux.restaurerVersion.mockResolvedValue('tab-1')
  tableaux.supprimerTableau.mockResolvedValue(undefined)
  tableaux.dupliquerTableau.mockResolvedValue('copie-9')
  audit.enregistrerAudit.mockImplementation(async () => { ordre.appels.push('audit') })
  cache.revalidatePath.mockImplementation(() => { ordre.appels.push('revalidate') })
  navigation.redirect.mockImplementation((url: string) => { ordre.appels.push('redirect'); throw new Error(`REDIRECT:${url}`) })
})

describe('audit de l’action restaurer', () => {
  const valide = { id: 'tab-1', version: '2', versionCourante: '5' }

  it('enregistre une seule entrée après succès, avant revalidation et redirection', async () => {
    await expect(restaurer({}, formulaire(valide))).rejects.toThrow('REDIRECT:/tableaux/tab-1')
    expect(audit.enregistrerAudit).toHaveBeenCalledTimes(1)
    expect(audit.enregistrerAudit).toHaveBeenCalledWith({
      acteurId: 'u1',
      action: 'tableau.restauration',
      cible: { type: 'tableau', id: 'tab-1' },
      details: { version: 2, versionCourante: 5 },
    })
    expect(ordre.appels).toEqual(['audit', 'revalidate', 'revalidate', 'revalidate', 'redirect'])
  })

  it.each([
    ['session refusée', () => garde.exigerMedicAssist.mockResolvedValue({ ok: false }), valide],
    ['entrée invalide', () => undefined, { ...valide, version: '0' }],
    ['id manquant', () => undefined, { version: '2', versionCourante: '5' }],
    ['ErreurTableau', () => tableaux.restaurerVersion.mockRejectedValue(new tableaux.ErreurTableau('x')), valide],
    ['ErreurVersionIncompatible', () => tableaux.restaurerVersion.mockRejectedValue(new tableaux.ErreurVersionIncompatible('x')), valide],
    ['erreur inconnue', () => tableaux.restaurerVersion.mockRejectedValue(new Error('boom')), valide],
  ])('n’enregistre rien sur échec : %s', async (_nom, preparer, champs) => {
    preparer()
    const etat = await restaurer({}, formulaire(champs))
    expect(etat.erreur).toBeTruthy()
    expect(audit.enregistrerAudit).not.toHaveBeenCalled()
    expect(navigation.redirect).not.toHaveBeenCalled()
  })
})

describe('audit de l’action supprimer', () => {
  const valide = { id: 'tab-1', confirmation: 'on' }

  it('enregistre une seule entrée après succès, avant revalidation et redirection', async () => {
    await expect(supprimer({}, formulaire(valide))).rejects.toThrow('REDIRECT:/tableaux')
    expect(audit.enregistrerAudit).toHaveBeenCalledTimes(1)
    expect(audit.enregistrerAudit).toHaveBeenCalledWith({
      acteurId: 'u1',
      action: 'tableau.suppression',
      cible: { type: 'tableau', id: 'tab-1' },
    })
    expect(ordre.appels).toEqual(['audit', 'revalidate', 'redirect'])
  })

  it('ne met ni titre ni détail dans l’entrée', async () => {
    await expect(supprimer({}, formulaire(valide))).rejects.toThrow()
    const entree = audit.enregistrerAudit.mock.calls[0]![0]
    expect(entree.cible).not.toHaveProperty('libelle')
    expect(entree).not.toHaveProperty('details')
  })

  it.each([
    ['session refusée', () => garde.exigerMedicAssist.mockResolvedValue({ ok: false }), valide],
    ['entrée invalide', () => undefined, { confirmation: 'on' }],
    ['confirmation absente', () => undefined, { id: 'tab-1' }],
    ['ErreurTableau', () => tableaux.supprimerTableau.mockRejectedValue(new tableaux.ErreurTableau('x')), valide],
    ['ErreurVersionIncompatible', () => tableaux.supprimerTableau.mockRejectedValue(new tableaux.ErreurVersionIncompatible('x')), valide],
    ['erreur inconnue', () => tableaux.supprimerTableau.mockRejectedValue(new Error('boom')), valide],
  ])('n’enregistre rien sur échec : %s', async (_nom, preparer, champs) => {
    preparer()
    const etat = await supprimer({}, formulaire(champs))
    expect(etat.erreur).toBeTruthy()
    expect(audit.enregistrerAudit).not.toHaveBeenCalled()
    expect(navigation.redirect).not.toHaveBeenCalled()
  })
})

describe('audit de l’action dupliquer', () => {
  const valide = { id: 'tab-1' }

  it('enregistre une seule entrée sur la copie, après succès et avant revalidation et redirection', async () => {
    await expect(dupliquer({}, formulaire(valide))).rejects.toThrow('REDIRECT:/tableaux/copie-9')
    expect(audit.enregistrerAudit).toHaveBeenCalledTimes(1)
    expect(audit.enregistrerAudit).toHaveBeenCalledWith({
      acteurId: 'u1',
      action: 'tableau.duplication',
      cible: { type: 'tableau', id: 'copie-9' },
      details: { origine: 'tab-1' },
    })
    expect(ordre.appels).toEqual(['audit', 'revalidate', 'redirect'])
  })

  it.each([
    ['session refusée', () => garde.exigerMedicAssist.mockResolvedValue({ ok: false }), valide],
    ['entrée invalide', () => undefined, { id: 'x'.repeat(65) }],
    ['id manquant', () => undefined, {}],
    ['ErreurTableau', () => tableaux.dupliquerTableau.mockRejectedValue(new tableaux.ErreurTableau('x')), valide],
    ['ErreurVersionIncompatible', () => tableaux.dupliquerTableau.mockRejectedValue(new tableaux.ErreurVersionIncompatible('x')), valide],
    ['erreur inconnue', () => tableaux.dupliquerTableau.mockRejectedValue(new Error('boom')), valide],
  ])('n’enregistre rien sur échec : %s', async (_nom, preparer, champs) => {
    preparer()
    const etat = await dupliquer({}, formulaire(champs))
    expect(etat.erreur).toBeTruthy()
    expect(audit.enregistrerAudit).not.toHaveBeenCalled()
    expect(navigation.redirect).not.toHaveBeenCalled()
  })
})
