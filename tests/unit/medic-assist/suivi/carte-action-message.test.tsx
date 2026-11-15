import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CarteAction } from '@/components/medic-assist/suivi/carte-action'
import type { ActionProposee } from '@/lib/medic-assist/contrats'

const lireActionMock = vi.fn()

vi.mock('@/components/medic-assist/suivi/api-client', () => ({
  lireAction: (...a: unknown[]) => lireActionMock(...a),
  confirmerAction: vi.fn(),
  annulerAction: vi.fn(),
  resoudreComptes: vi.fn(async () => []),
  rechercherComptes: vi.fn(async () => []),
  useAfficherErreur: () => vi.fn(),
}))
vi.mock('@/components/medic-assist/suivi/use-moi', () => ({ useMoi: () => null }))
vi.mock('@/components/medic-assist/suivi/selecteur-utilisateurs', () => ({
  SelecteurUtilisateurs: () => <div data-testid="selecteur" />,
}))

const MESSAGE = [
  'Bonjour,',
  'Voir https://piege.example/vite et',
  '<a href="https://piege.example">cliquez</a>',
  '<script>alert(1)</script>',
].join('\n')

function action(over: Partial<ActionProposee> = {}): ActionProposee {
  return {
    id: 'act-1',
    type: 'envoyer_email',
    statut: 'proposee',
    parametres: { artefactId: 'a1', destinataires: ['u1'], formats: ['pdf'], message: MESSAGE },
    resume: 'Envoyer le rapport.',
    conversationId: 'c1',
    creeA: '2026-01-01T00:00:00.000Z',
    ...over,
  } as ActionProposee
}

describe('CarteAction : message d’un e-mail à confirmer', () => {
  beforeEach(() => {
    lireActionMock.mockReset()
  })

  it('affiche le message intégral en texte brut, sans lien ni HTML interprété', async () => {
    const a = action()
    lireActionMock.mockResolvedValue(a)
    const { container } = render(<CarteAction action={a} />)

    const libelle = await screen.findByText('Message qui sera envoyé')
    const bloc = screen.getByTestId('message-envoye')
    expect(bloc).toContainElement(libelle)

    const zone = screen.getByRole('region', { name: 'Message qui sera envoyé' })
    expect(zone.textContent).toBe(MESSAGE)
    expect(zone).toHaveClass('whitespace-pre-wrap', 'break-words')
    expect(zone).toHaveAttribute('dir', 'auto')
    expect(zone).toHaveAttribute('tabindex', '0')
    expect(bloc.querySelector('a')).toBeNull()
    expect(container.querySelector('a[href="https://piege.example"]')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('n’affiche aucun bloc message pour une tâche', async () => {
    const a = action({
      type: 'creer_tache',
      parametres: { titre: 'T', assigneA: 'u1', message: 'ignoré' },
    })
    lireActionMock.mockResolvedValue(a)
    render(<CarteAction action={a} />)
    await screen.findByText('À confirmer')
    expect(screen.queryByTestId('message-envoye')).toBeNull()
    expect(screen.queryByText('Message qui sera envoyé')).toBeNull()
  })

  it('n’affiche rien sans message, ni une fois l’action exécutée', async () => {
    const sans = action({ parametres: { artefactId: 'a1', destinataires: ['u1'], formats: ['pdf'] } })
    lireActionMock.mockResolvedValue(sans)
    const { unmount } = render(<CarteAction action={sans} />)
    await screen.findByText('À confirmer')
    expect(screen.queryByTestId('message-envoye')).toBeNull()
    unmount()

    const faite = action({ statut: 'executee' })
    lireActionMock.mockResolvedValue(faite)
    render(<CarteAction action={faite} />)
    await screen.findByText('Fait')
    expect(screen.queryByTestId('message-envoye')).toBeNull()
  })
})
