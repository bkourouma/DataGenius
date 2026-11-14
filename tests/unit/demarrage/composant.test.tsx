import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const masquerDemarrage = vi.hoisted(() => vi.fn())
vi.mock('@/app/(dashboard)/medic-assist/actions', () => ({ masquerDemarrage }))

import { Demarrage, DemarrageProvider } from '@/components/medic-assist/chat/demarrage'
import type { ValeurDemarrage } from '@/lib/medic-assist/demarrage'

const valeur: ValeurDemarrage = {
  affichage: 'admin',
  etapes: [
    { cle: 'source', fait: true, href: '/sources' },
    { cle: 'import', fait: false, href: '/sources' },
    { cle: 'catalogue', fait: false, href: '/sources' },
    { cle: 'question', fait: false, href: null },
    { cle: 'collegue', fait: false, href: '/utilisateurs' },
  ],
}

describe('<Demarrage />', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ne rend rien sans provider', () => {
    const { container } = render(<Demarrage />)
    expect(container).toBeEmptyDOMElement()
  })

  it('admin : progression, 5 etapes, liens des etapes a faire', () => {
    render(<DemarrageProvider valeur={valeur}><Demarrage /></DemarrageProvider>)
    expect(screen.getByRole('heading', { name: 'Premiers pas' })).toBeInTheDocument()
    expect(screen.getByText('1 sur 5')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByRole('link', { name: 'Ajouter une source' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Importer un jeu' })).toHaveAttribute('href', '/sources')
    expect(screen.getByRole('link', { name: 'Inviter un collègue' })).toHaveAttribute('href', '/utilisateurs')
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })

  it('masquer : appelle l’action puis disparait', async () => {
    masquerDemarrage.mockResolvedValue({ ok: true })
    render(<DemarrageProvider valeur={valeur}><Demarrage /></DemarrageProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Masquer ce guide' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Premiers pas' })).toBeNull())
    expect(masquerDemarrage).toHaveBeenCalledTimes(1)
  })

  it('masquer en echec : le guide reste visible', async () => {
    masquerDemarrage.mockResolvedValue({ ok: false })
    render(<DemarrageProvider valeur={valeur}><Demarrage /></DemarrageProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Masquer ce guide' }))
    await waitFor(() => expect(masquerDemarrage).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: 'Premiers pas' })).toBeInTheDocument()
  })

  it('membre sans jeu : bloc status', () => {
    render(<DemarrageProvider valeur={{ affichage: 'membre-sans-jeu', etapes: [] }}><Demarrage /></DemarrageProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('Aucune donnée accessible')
  })
})
