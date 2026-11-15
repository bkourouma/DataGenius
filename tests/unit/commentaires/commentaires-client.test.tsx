import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ajouter, supprimer } = vi.hoisted(() => ({ ajouter: vi.fn(), supprimer: vi.fn() }))

vi.mock('next-intl', () => ({
  useLocale: () => 'fr',
  useTranslations: () => (cle: string, valeurs?: Record<string, unknown>) =>
    valeurs ? `${cle}:${Object.values(valeurs).join('|')}` : cle,
}))
vi.mock('@/lib/commentaires/actions', () => ({ ajouter, supprimer }))

import { CommentairesClient } from '@/components/commentaires/commentaires-client'

const liste = [
  { id: 'c1', texte: '<b>gras</b>\nligne', auteurNom: 'Awa', auteurId: 'u1', creeLe: '2026-01-02T03:04:05.000Z', supprimable: true },
  { id: 'c2', texte: 'autre', auteurNom: 'Moi', auteurId: 'u2', creeLe: '2026-01-02T04:00:00.000Z', supprimable: false },
]

beforeEach(() => vi.clearAllMocks())

describe('CommentairesClient', () => {
  it('rend le texte en brut (HTML non interprété) et limite la suppression aux lignes supprimables', () => {
    const { container } = render(<CommentairesClient artefactId="a" commentaires={liste} />)
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText(/<b>gras<\/b>/)).toBeInTheDocument()
    expect(screen.getAllByText('supprimer')).toHaveLength(1)
  })

  it('désactive l’envoi tant que le texte est vide, affiche le compteur et envoie', async () => {
    ajouter.mockResolvedValue({ ok: true })
    render(<CommentairesClient artefactId="a" commentaires={[]} />)
    const bouton = screen.getByRole('button', { name: 'envoyer' })
    expect(bouton).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } })
    expect(screen.getByText('restants:1997')).toBeInTheDocument()
    fireEvent.click(bouton)
    await waitFor(() => expect(ajouter).toHaveBeenCalledWith('a', 'abc'))
  })

  it('affiche le message traduit du code d’erreur dans une zone aria-live', async () => {
    ajouter.mockResolvedValue({ erreur: 'limite_debit' })
    render(<CommentairesClient artefactId="a" commentaires={[]} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'envoyer' }))
    const alerte = await screen.findByRole('alert')
    expect(alerte).toHaveTextContent('limite_debit')
    expect(alerte.parentElement).toHaveAttribute('aria-live', 'polite')
  })

  it('demande une confirmation avant de supprimer', async () => {
    supprimer.mockResolvedValue({ ok: true })
    render(<CommentairesClient artefactId="a" commentaires={liste} />)
    fireEvent.click(screen.getByText('supprimer'))
    expect(supprimer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('confirmer'))
    await waitFor(() => expect(supprimer).toHaveBeenCalledWith('c1'))
  })
})
