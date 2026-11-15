import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ executeRaw: vi.fn(), erreur: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ prisma: { $executeRaw: mocks.executeRaw } }))
vi.mock('@/lib/journal', () => ({ journal: { erreur: mocks.erreur, info: vi.fn(), avertissement: vi.fn() } }))

import { enregistrerAudit } from '@/lib/audit/enregistrer'

describe('enregistrerAudit', () => {
  beforeEach(() => {
    mocks.executeRaw.mockReset()
    mocks.erreur.mockReset()
  })

  it('cas nominal : une seule écriture, rien de journalisé', async () => {
    mocks.executeRaw.mockResolvedValue(1)
    await enregistrerAudit({ acteurId: 'u1', action: 'source.creation', cible: { type: 'source', id: 's1' } })
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
    expect(mocks.erreur).not.toHaveBeenCalled()
  })

  it('une écriture qui rejette ne fait pas échouer l\'appelant ; erreur journalisée sans détail', async () => {
    const brute = Object.assign(new Error('secret@example.test violation'), { name: 'PrismaClientKnownRequestError' })
    mocks.executeRaw.mockRejectedValue(brute)
    await expect(enregistrerAudit({
      acteurId: 'u1', action: 'connexion.echec', details: { motif: 'x' },
    })).resolves.toBeUndefined()
    expect(mocks.erreur).toHaveBeenCalledTimes(1)
    const [message, champs] = mocks.erreur.mock.calls[0]
    expect(message).toBe('Journal d\'audit : écriture impossible')
    expect(champs).toEqual({ domaine: 'audit', action: 'connexion.echec', erreur: 'PrismaClientKnownRequestError' })
    expect(JSON.stringify(mocks.erreur.mock.calls)).not.toContain('secret@example.test')
  })

  it('une erreur synchrone est aussi absorbée', async () => {
    mocks.executeRaw.mockImplementation(() => { throw new TypeError('boum') })
    await expect(enregistrerAudit({ action: 'journal.export' })).resolves.toBeUndefined()
    expect(mocks.erreur).toHaveBeenCalledWith(
      'Journal d\'audit : écriture impossible',
      { domaine: 'audit', action: 'journal.export', erreur: 'TypeError' },
    )
  })

  it('des détails inattendus (cycle) n\'empêchent pas le retour normal', async () => {
    mocks.executeRaw.mockResolvedValue(1)
    const cycle: Record<string, unknown> = {}
    cycle.soi = cycle
    await expect(enregistrerAudit({ action: 'source.creation', details: cycle })).resolves.toBeUndefined()
  })

  describe('libellé de cible', () => {
    const valeursInterpolees = () => mocks.executeRaw.mock.calls[0].slice(1) as unknown[]

    it('un libellé contenant une adresse e-mail est écrit masqué', async () => {
      mocks.executeRaw.mockResolvedValue(1)
      await enregistrerAudit({
        acteurId: 'u1', action: 'source.creation',
        cible: { type: 'utilisateur', id: 'x1', libelle: 'Compte de jean.dupont@example.test (Abidjan)' },
      })
      const valeurs = valeursInterpolees()
      expect(valeurs).toContain('[masqué]')
      expect(valeurs.filter((v) => typeof v === 'string' && v.includes('@'))).toEqual([])
    })

    it('un libellé normal reste intact, et est tronqué à 200 caractères', async () => {
      mocks.executeRaw.mockResolvedValue(1)
      await enregistrerAudit({ action: 'source.creation', cible: { type: 'source', id: 's1', libelle: 'Source ventes' } })
      expect(valeursInterpolees()).toContain('Source ventes')

      mocks.executeRaw.mockClear()
      await enregistrerAudit({ action: 'source.creation', cible: { type: 'source', id: 's1', libelle: 'x'.repeat(500) } })
      expect(valeursInterpolees()).toContain('x'.repeat(200))
      expect(valeursInterpolees()).not.toContain('x'.repeat(201))
    })
  })
})
