import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { changerLangue, refresh } = vi.hoisted(() => ({
  changerLangue: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/i18n/actions', () => ({ changerLangue }))
vi.mock('@/components/notifications/cloche-notifications', () => ({ ClocheNotifications: () => null }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => '/assistant/analyses/abc',
}))

import { Coquille } from '@/components/coquille/coquille'
import { PaletteCommandes } from '@/components/coquille/palette-commandes'
import { groupesNavigation } from '@/components/coquille/navigation'
import { SelecteurLangue } from '@/components/coquille/selecteur-langue'
import { LOCALE_NAMES, locales } from '@/i18n/config'

beforeEach(() => {
  changerLangue.mockResolvedValue({ ok: true })
})

describe('Coquille (français inchangé)', () => {
  it('membre : navigation de travail, recherche, déconnexion, rôle', () => {
    render(<Coquille estAdmin={false} nom="Awa Koné" courriel="awa@x.fr">contenu</Coquille>)
    const rail = screen.getAllByRole('navigation', { name: 'Espace de travail' })[0]
    for (const libelle of ['Conversations', 'Analyses', 'Tableaux de bord', 'Tendances', 'Espaces', 'Recherche', 'Glossaire']) {
      expect(within(rail).getByRole('link', { name: libelle })).toBeInTheDocument()
    }
    expect(within(rail).queryByText('Administration')).not.toBeInTheDocument()
    expect(within(rail).getByRole('link', { name: 'Analyses' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getAllByText('Rechercher').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Rechercher ou demander' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Se déconnecter' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Membre').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Ouvrir le menu' })).toBeInTheDocument()
    expect(screen.getAllByText('AK').length).toBeGreaterThan(0)
  })

  it('administrateur : groupes Travail et Administration et leurs entrées', () => {
    render(<Coquille estAdmin nom={null} courriel={null}>contenu</Coquille>)
    const rail = screen.getAllByRole('navigation', { name: 'Espace de travail' })[0]
    expect(within(rail).getByText('Travail')).toBeInTheDocument()
    expect(within(rail).getByText('Administration')).toBeInTheDocument()
    for (const libelle of ['Sources', 'Utilisateurs', 'Droits d’accès', 'Paramètres', 'Journal d’audit']) {
      expect(within(rail).getByRole('link', { name: libelle })).toBeInTheDocument()
    }
    expect(screen.getAllByText('Administrateur').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Compte').length).toBeGreaterThan(0)
  })

  it('le pied du rail contient le sélecteur de langue', () => {
    render(<Coquille estAdmin={false} nom="Awa" courriel={null}>contenu</Coquille>)
    expect(screen.getAllByRole('combobox', { name: 'Langue de l’interface' }).length).toBeGreaterThan(0)
  })
})

describe('SelecteurLangue', () => {
  it.each(['rail', 'page'] as const)('variante %s : rend les 6 langues dans leur propre langue', (variante) => {
    render(<SelecteurLangue variante={variante} />)
    const liste = screen.getByRole('combobox', { name: 'Langue de l’interface' })
    const options = within(liste).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(locales.map((l) => LOCALE_NAMES[l]))
    for (const o of options) expect(o).toHaveAttribute('lang')
    expect(options.find((o) => o.textContent === 'العربية')).toHaveAttribute('lang', 'ar')
    expect(liste).toHaveValue('fr')
  })

  it('un choix appelle l’action puis rafraîchit la page', async () => {
    render(<SelecteurLangue variante="page" />)
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } }) })
    expect(changerLangue).toHaveBeenCalledWith('en')
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('pas de rafraîchissement si l’action échoue ; la langue déjà choisie n’appelle rien', async () => {
    changerLangue.mockResolvedValue({ ok: false })
    render(<SelecteurLangue variante="rail" />)
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'es' } }) })
    await vi.waitFor(() => expect(changerLangue).toHaveBeenCalledWith('es'))
    expect(refresh).not.toHaveBeenCalled()
    changerLangue.mockClear()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr' } })
    expect(changerLangue).not.toHaveBeenCalled()
  })

  it('désactivé pendant l’appel', async () => {
    let fin: (v: { ok: boolean }) => void = () => {}
    changerLangue.mockReturnValue(new Promise((r) => { fin = r }))
    render(<SelecteurLangue variante="page" />)
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh' } }) })
    await vi.waitFor(() => expect(screen.getByRole('combobox')).toBeDisabled())
    await act(async () => { fin({ ok: true }) })
    expect(screen.getByRole('combobox')).not.toBeDisabled()
  })
})

describe('PaletteCommandes (français inchangé)', () => {
  it('libellés d’interface et sections', () => {
    render(<PaletteCommandes ouverte onOuverteChange={() => {}} groupes={groupesNavigation(true)} />)
    expect(screen.getByPlaceholderText('Aller à une page ou poser une question…')).toBeInTheDocument()
    expect(screen.getByText('Échap')).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'Commandes' })).toBeInTheDocument()
    expect(screen.getByText('Aller à')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Nouvelle conversation/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Journal d’audit/ })).toBeInTheDocument()
    expect(screen.getByText('Entrée')).toBeInTheDocument()
    expect(screen.getByText('Tapez une question pour l’envoyer à l’assistant')).toBeInTheDocument()
  })

  it('une saisie sans page correspondante propose de demander à l’assistant', () => {
    render(<PaletteCommandes ouverte onOuverteChange={() => {}} groupes={groupesNavigation(false)} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzqx' } })
    expect(screen.getByText('Demander')).toBeInTheDocument()
    expect(screen.getByText('Poser la question à l’assistant')).toBeInTheDocument()
  })

  it('les mots-clés français retrouvent la page, accents ignorés', () => {
    render(<PaletteCommandes ouverte onOuverteChange={() => {}} groupes={groupesNavigation(true)} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'parametres' } })
    expect(screen.getByRole('option', { name: /Paramètres/ })).toBeInTheDocument()
  })
})
