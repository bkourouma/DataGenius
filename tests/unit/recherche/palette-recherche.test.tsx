import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/actions', () => ({ changerLangue: vi.fn() }))
vi.mock('@/components/notifications/cloche-notifications', () => ({ ClocheNotifications: () => null }))

import { groupesNavigation } from '@/components/coquille/navigation'
import { PaletteCommandes } from '@/components/coquille/palette-commandes'

function saisir(valeur: string) {
  render(<PaletteCommandes ouverte onOuverteChange={() => {}} groupes={groupesNavigation(false)} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: valeur } })
}

describe('palette : recherche globale', () => {
  it('propose « Rechercher « … » partout » de 2 à 100 caractères', () => {
    saisir('ca')
    expect(screen.getByRole('option', { name: /Rechercher « ca » partout/ })).toBeInTheDocument()
  })

  it('accepte exactement 100 caractères', () => {
    const q = 'a'.repeat(100)
    saisir(q)
    expect(screen.getByRole('option', { name: new RegExp(`Rechercher « ${q} » partout`) })).toBeInTheDocument()
  })

  it('ne la propose pas pour un seul caractère', () => {
    saisir('c')
    expect(screen.queryByRole('option', { name: /partout/ })).toBeNull()
  })

  it('ne la propose pas au-delà de 100 caractères', () => {
    saisir('a'.repeat(101))
    expect(screen.queryByRole('option', { name: /partout/ })).toBeNull()
  })
})
