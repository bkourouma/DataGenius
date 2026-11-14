import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { comptes, ErreurComptes } = vi.hoisted(() => {
  class ErreurComptes extends Error {}
  return { ErreurComptes, comptes: {
  demanderReinitialisation: vi.fn(),
  verifierJeton: vi.fn(),
  definirMotDePasse: vi.fn(),
  } }
})

vi.mock('@/lib/auth/comptes', () => ({ ...comptes, ErreurComptes }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))
vi.mock('react-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-dom')>()
  return {
    ...actual,
    useFormState: (_action: unknown, initial: unknown) => [initial, vi.fn()],
    useFormStatus: () => ({ pending: false }),
  }
})

import { messageErreurConnexion } from '@/app/login/messages'
import { demanderLienAction } from '@/app/mot-de-passe-oublie/actions'
import { definirMotDePasseAction } from '@/app/definir-mot-de-passe/actions'
import DefinirMotDePasse from '@/app/definir-mot-de-passe/page'

function formulaire(champs: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(champs)) f.set(k, v)
  return f
}

beforeEach(() => {
  comptes.demanderReinitialisation.mockReset()
  comptes.verifierJeton.mockReset()
  comptes.definirMotDePasse.mockReset()
})

describe('messageErreurConnexion', () => {
  it('trop_de_tentatives', () => {
    expect(messageErreurConnexion('trop_de_tentatives', 'formulaire')).toBe('Trop de tentatives. Réessayez dans 15 minutes.')
    expect(messageErreurConnexion('trop_de_tentatives', 'url')).toBe('Trop de tentatives. Réessayez dans 15 minutes.')
  })
  it('CredentialsSignin et codes inconnus', () => {
    expect(messageErreurConnexion('CredentialsSignin', 'formulaire')).toBe('Identifiants invalides.')
    expect(messageErreurConnexion(undefined, 'formulaire')).toBe('Identifiants invalides.')
    expect(messageErreurConnexion('CredentialsSignin', 'url')).toBe('Connexion impossible. Vérifiez que votre compte est autorisé.')
    expect(messageErreurConnexion('Xyz', 'url')).not.toContain('Xyz')
  })
})

describe('demanderLienAction', () => {
  it('renvoie le même résultat pour compte connu, inconnu et erreur interne', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    comptes.demanderReinitialisation.mockResolvedValueOnce(undefined)
    const connu = await demanderLienAction({}, formulaire({ email: 'a@x.fr' }))
    comptes.demanderReinitialisation.mockResolvedValueOnce(undefined)
    const inconnu = await demanderLienAction({}, formulaire({ email: 'b@x.fr' }))
    comptes.demanderReinitialisation.mockRejectedValueOnce(new Error('smtp a@x.fr'))
    const erreur = await demanderLienAction({}, formulaire({ email: 'c@x.fr' }))
    expect(inconnu).toEqual(connu)
    expect(erreur).toEqual(connu)
    expect(connu.confirmation).toContain('Le lien est valable 1 heure.')
    expect(console.error).toHaveBeenCalledWith('[datagenius] comptes', { action: 'reinitialisation_erreur' })
  })
})

describe('page definir-mot-de-passe', () => {
  it('jeton absent ou invalide : message unique', async () => {
    comptes.verifierJeton.mockResolvedValue({ valide: false })
    render(await DefinirMotDePasse({ searchParams: {} }))
    expect(screen.getByRole('alert')).toHaveTextContent('Ce lien est invalide ou a expiré.')
    expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute('href', '/mot-de-passe-oublie')
    expect(comptes.verifierJeton).not.toHaveBeenCalled()
    render(await DefinirMotDePasse({ searchParams: { jeton: 'mauvais' } }))
    expect(comptes.verifierJeton).toHaveBeenCalledWith('mauvais')
  })

  it('invitation valide', async () => {
    comptes.verifierJeton.mockResolvedValue({ valide: true, type: 'invitation', prenom: 'Awa' })
    const { container } = render(await DefinirMotDePasse({ searchParams: { jeton: 'ok' } }))
    expect(screen.getByRole('heading', { name: 'Bienvenue, Awa' })).toBeInTheDocument()
    expect(screen.getByText('Choisissez votre mot de passe')).toBeInTheDocument()
    expect(container.querySelector('input[name="jeton"]')).toHaveValue('ok')
    expect(container.querySelector('input[name="motDePasse"]')).toHaveAttribute('minlength', '12')
  })

  it('réinitialisation valide', async () => {
    comptes.verifierJeton.mockResolvedValue({ valide: true, type: 'reinitialisation', prenom: 'Awa' })
    render(await DefinirMotDePasse({ searchParams: { jeton: 'ok' } }))
    expect(screen.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeInTheDocument()
  })
})

describe('definirMotDePasseAction', () => {
  const mdp = 'un-mot-de-passe-long'
  it('mots de passe différents : erreur sans appel', async () => {
    const r = await definirMotDePasseAction({}, formulaire({ jeton: 't', motDePasse: mdp, confirmation: mdp + 'x' }))
    expect(r.erreur).toBeTruthy()
    expect(JSON.stringify(r)).not.toContain(mdp)
    expect(comptes.definirMotDePasse).not.toHaveBeenCalled()
  })
  it('ErreurComptes : son message', async () => {
    comptes.definirMotDePasse.mockRejectedValue(new ErreurComptes('Trop court.'))
    expect(await definirMotDePasseAction({}, formulaire({ jeton: 't', motDePasse: mdp, confirmation: mdp }))).toEqual({ erreur: 'Trop court.' })
  })
  it('erreur inconnue : message générique', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    comptes.definirMotDePasse.mockRejectedValue(new Error('boom t'))
    const r = await definirMotDePasseAction({}, formulaire({ jeton: 't', motDePasse: mdp, confirmation: mdp }))
    expect(r.erreur).toBe('Impossible de définir le mot de passe. Réessayez.')
  })
  it('succès : redirection vers /login?reinitialise=1', async () => {
    comptes.definirMotDePasse.mockResolvedValue(undefined)
    await expect(definirMotDePasseAction({}, formulaire({ jeton: 't', motDePasse: mdp, confirmation: mdp }))).rejects.toThrow('REDIRECT:/login?reinitialise=1')
    expect(comptes.definirMotDePasse).toHaveBeenCalledWith('t', mdp)
  })
})
