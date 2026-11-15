import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ audit: vi.fn(), garde: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (cle: string) => cle }))
vi.mock('@/lib/audit/enregistrer', () => ({ enregistrerAudit: m.audit }))
vi.mock('@/lib/journal', () => ({ journal: { erreur: vi.fn(), info: vi.fn(), avertissement: vi.fn() } }))
vi.mock('@/lib/medic-assist/acces', () => ({ exigerAdminMedicAssist: m.garde }))
vi.mock('@/lib/auth/comptes', () => {
  class ErreurComptes extends Error {}
  return {
    ErreurComptes,
    inviterUtilisateur: vi.fn(), renvoyerInvitation: vi.fn(), desactiverCompte: vi.fn(),
    reactiverCompte: vi.fn(), changerRoleCompte: vi.fn(),
  }
})

import * as comptes from '@/lib/auth/comptes'
import { changerRole, desactiver, inviter, reactiver, renvoyer } from '@/app/(dashboard)/utilisateurs/actions'

const EMAIL = 'personne.secrete@exemple.fr'
function form() {
  const f = new FormData()
  for (const [k, v] of Object.entries({ email: EMAIL, prenom: 'Ada', nom: 'L', role: 'Member', compteId: 'cible' })) f.set(k, v)
  return f
}

const cas = [
  { nom: 'inviter', run: () => inviter({}, form()), metier: comptes.inviterUtilisateur, action: 'utilisateur.invitation' },
  { nom: 'renvoyer', run: () => renvoyer({}, form()), metier: comptes.renvoyerInvitation, action: 'utilisateur.invitation_renvoyee' },
  { nom: 'desactiver', run: () => desactiver({}, form()), metier: comptes.desactiverCompte, action: 'utilisateur.desactivation' },
  { nom: 'reactiver', run: () => reactiver({}, form()), metier: comptes.reactiverCompte, action: 'utilisateur.reactivation' },
  { nom: 'changerRole', run: () => changerRole({}, form()), metier: comptes.changerRoleCompte, action: 'utilisateur.role_modifie' },
]

beforeEach(() => {
  vi.resetAllMocks()
  m.garde.mockResolvedValue({ ok: true, contexte: { userId: 'admin-1' } })
  m.audit.mockResolvedValue(undefined)
  vi.mocked(comptes.inviterUtilisateur).mockResolvedValue({ lien: 'l', envoye: true })
  vi.mocked(comptes.renvoyerInvitation).mockResolvedValue({ lien: 'l', envoye: false })
})

describe.each(cas)('$nom', ({ run, metier, action }) => {
  it('succès : un appel après l’opération, acteur = admin', async () => {
    await run()
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ acteurId: 'admin-1', action, cible: expect.objectContaining({ type: 'utilisateur' }) }))
    expect(vi.mocked(metier).mock.invocationCallOrder[0]!).toBeLessThan(m.audit.mock.invocationCallOrder[0]!)
  })

  it.each([
    ['ErreurComptes', () => new comptes.ErreurComptes('refus métier')],
    ['erreur inattendue', () => new Error('boom')],
  ])('échec (%s) : aucun appel', async (_n, erreur) => {
    vi.mocked(metier).mockRejectedValue(erreur())
    await run()
    expect(m.audit).not.toHaveBeenCalled()
  })

  it('non-admin : aucun appel', async () => {
    m.garde.mockResolvedValue({ ok: false })
    await run()
    expect(m.audit).not.toHaveBeenCalled()
  })

  it('l’e-mail du formulaire n’apparaît jamais dans l’appel d’audit', async () => {
    await run()
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain(EMAIL)
  })
})

describe('détails', () => {
  it('invitation : rôle et envoi, sans e-mail', async () => {
    await inviter({}, form())
    expect(m.audit.mock.calls[0]![0].details).toEqual({ role: 'Member', envoye: true })
  })
  it('changement de rôle : rôle', async () => {
    await changerRole({}, form())
    expect(m.audit.mock.calls[0]![0]).toMatchObject({ cible: { type: 'utilisateur', id: 'cible' }, details: { role: 'Member' } })
  })
})
