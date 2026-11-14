import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// react-dom 18 hors Next n'expose pas useFormState : on le remplace par un état figé.
vi.mock('react-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  useFormState: (_action: unknown, initial: unknown) => [initial, vi.fn()],
  useFormStatus: () => ({ pending: false }),
}))
vi.mock('@/app/(dashboard)/utilisateurs/actions', () => ({
  inviter: vi.fn(), renvoyer: vi.fn(), desactiver: vi.fn(), reactiver: vi.fn(), changerRole: vi.fn(),
}))

import { ActionsCompte, LienInvitation, type CompteAffiche } from '@/app/(dashboard)/utilisateurs/composants'

const base: CompteAffiche = {
  id: 'u1', email: 'a@x.fr', prenom: 'Ada', nom: 'Lovelace', roleName: 'Member',
  statut: 'actif', oidc: false, groupes: [], invitationExpireA: null,
}

describe('ActionsCompte', () => {
  it('ne propose aucune action sur son propre compte', () => {
    render(<ActionsCompte compte={base} utilisateurCourantId="u1" />)
    expect(screen.getByText('Vous ne pouvez pas modifier votre propre compte ici.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('demande confirmation avant de désactiver', () => {
    render(<ActionsCompte compte={base} utilisateurCourantId="moi" />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Désactiver' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText(/ne pourra plus se connecter/)).toBeInTheDocument()
  })

  it('demande confirmation avant un changement de rôle', () => {
    render(<ActionsCompte compte={base} utilisateurCourantId="moi" />)
    fireEvent.click(screen.getByRole('button', { name: 'Passer administrateur' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('propose Renvoyer pour un invité et Réactiver pour un compte désactivé', () => {
    const { rerender } = render(<ActionsCompte compte={{ ...base, statut: 'invite' }} utilisateurCourantId="moi" />)
    expect(screen.getByRole('button', { name: 'Renvoyer l’invitation' })).toBeInTheDocument()
    rerender(<ActionsCompte compte={{ ...base, statut: 'desactive' }} utilisateurCourantId="moi" />)
    expect(screen.getByRole('button', { name: 'Réactiver' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Désactiver' })).toBeNull()
  })
})

describe('LienInvitation', () => {
  it('affiche le lien en lecture seule avec l’avertissement', () => {
    render(<LienInvitation lien="https://x/invitation/abc" />)
    const champ = screen.getByLabelText('Lien d’invitation') as HTMLInputElement
    expect(champ).toHaveAttribute('readonly')
    expect(champ.value).toBe('https://x/invitation/abc')
    expect(screen.getByText(/ne le partagez qu’avec la personne invitée/)).toBeInTheDocument()
  })

  it('copie sans erreur même si le presse-papiers échoue', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('refus'))
    render(<LienInvitation lien="https://x/y" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copier' }))
    expect(await screen.findByRole('button', { name: 'Copier' })).toBeInTheDocument()
  })
})
