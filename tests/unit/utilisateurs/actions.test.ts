import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/medic-assist/acces', () => ({ exigerAdminMedicAssist: vi.fn() }))
vi.mock('@/lib/auth/comptes', () => {
  class ErreurComptes extends Error {}
  return {
    ErreurComptes,
    inviterUtilisateur: vi.fn(),
    renvoyerInvitation: vi.fn(),
    desactiverCompte: vi.fn(),
    reactiverCompte: vi.fn(),
    changerRoleCompte: vi.fn(),
  }
})

import { revalidatePath } from 'next/cache'
import * as comptes from '@/lib/auth/comptes'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { changerRole, desactiver, inviter, reactiver, renvoyer } from '@/app/(dashboard)/utilisateurs/actions'

const garde = vi.mocked(exigerAdminMedicAssist)
const fonctionsComptes = [
  comptes.inviterUtilisateur, comptes.renvoyerInvitation, comptes.desactiverCompte,
  comptes.reactiverCompte, comptes.changerRoleCompte,
]

function formulaire(valeurs: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(valeurs)) f.set(k, v)
  return f
}

const entree = formulaire({ email: 'a@x.fr', prenom: 'Ada', nom: 'L', role: 'Member', compteId: 'cible' })
const actions = {
  inviter: () => inviter({}, entree),
  renvoyer: () => renvoyer({}, entree),
  desactiver: () => desactiver({}, entree),
  reactiver: () => reactiver({}, entree),
  changerRole: () => changerRole({}, entree),
}

beforeEach(() => {
  vi.clearAllMocks()
  garde.mockResolvedValue({ ok: true, contexte: { userId: 'admin-session' } } as never)
})

describe('garde administrateur', () => {
  it.each(Object.keys(actions))('%s : refus sans appeler la gestion des comptes', async nom => {
    garde.mockResolvedValue({ ok: false, reponse: {} } as never)
    const etat = await actions[nom as keyof typeof actions]()
    expect(etat).toEqual({ erreur: 'Accès réservé aux administrateurs.' })
    for (const f of fonctionsComptes) expect(f).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('acteur et paramètres', () => {
  it('utilise l’utilisateur de session comme acteur', async () => {
    vi.mocked(comptes.desactiverCompte).mockResolvedValue()
    vi.mocked(comptes.reactiverCompte).mockResolvedValue()
    vi.mocked(comptes.changerRoleCompte).mockResolvedValue()
    vi.mocked(comptes.renvoyerInvitation).mockResolvedValue({ lien: 'l', envoye: true })
    vi.mocked(comptes.inviterUtilisateur).mockResolvedValue({ lien: 'l', envoye: true })
    const f = formulaire({ compteId: 'cible', role: 'TenantAdmin', acteur: 'pirate', email: 'a@x.fr', prenom: 'A', nom: 'B' })
    await inviter({}, f); await renvoyer({}, f); await desactiver({}, f); await reactiver({}, f); await changerRole({}, f)
    expect(comptes.inviterUtilisateur).toHaveBeenCalledWith('admin-session', { email: 'a@x.fr', prenom: 'A', nom: 'B', role: 'TenantAdmin' })
    expect(comptes.renvoyerInvitation).toHaveBeenCalledWith('admin-session', 'cible')
    expect(comptes.desactiverCompte).toHaveBeenCalledWith('admin-session', 'cible')
    expect(comptes.reactiverCompte).toHaveBeenCalledWith('admin-session', 'cible')
    expect(comptes.changerRoleCompte).toHaveBeenCalledWith('admin-session', 'cible', 'TenantAdmin')
    expect(revalidatePath).toHaveBeenCalledWith('/utilisateurs')
  })
})

describe('erreurs', () => {
  it('affiche le message d’une ErreurComptes', async () => {
    vi.mocked(comptes.desactiverCompte).mockRejectedValue(new comptes.ErreurComptes('Dernier administrateur actif.'))
    expect(await desactiver({}, entree)).toEqual({ erreur: 'Dernier administrateur actif.' })
  })

  it('masque toute autre erreur et ne journalise ni e-mail ni jeton', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(comptes.inviterUtilisateur).mockRejectedValue(new Error('secret a@x.fr jeton-123'))
    const etat = await inviter({}, entree)
    expect(etat.erreur).toBe('Opération impossible pour le moment. Réessayez plus tard.')
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/a@x\.fr|jeton-123/)
    expect(revalidatePath).not.toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('lien d’invitation', () => {
  it('renvoie le lien seulement si le courrier n’est pas parti', async () => {
    vi.mocked(comptes.inviterUtilisateur).mockResolvedValue({ lien: 'https://x/y', envoye: false })
    const etat = await inviter({}, entree)
    expect(etat.lien).toBe('https://x/y')
    expect(etat.succes).toContain("Le courrier n'a pas pu être envoyé")
  })

  it('n’expose pas le lien quand le courrier est parti', async () => {
    vi.mocked(comptes.renvoyerInvitation).mockResolvedValue({ lien: 'https://x/y', envoye: true })
    const etat = await renvoyer({}, formulaire({ compteId: 'c', email: 'a@x.fr' }))
    expect(etat).toEqual({ succes: 'Invitation envoyée à a@x.fr.' })
    expect(etat.lien).toBeUndefined()
  })
})
