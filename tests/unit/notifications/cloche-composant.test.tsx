import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ClocheNotifications } from '@/components/notifications/cloche-notifications'

vi.mock('next/link', () => ({
  default: ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) =>
    <a href={href} onClick={event => { event.preventDefault(); onClick?.() }}>{children}</a>,
}))

type Element = { id: string; titre: string; message: string; lue: boolean; lien: string | null }

function notif(id: string, lue = false, lien: string | null = '/tableaux/abc'): Element & { type: string; creeLe: string } {
  return { id, type: 'tableau_alerte', titre: `Titre ${id}`, message: `Message ${id}`, lue, lien, creeLe: new Date(Date.now() - 5 * 60_000).toISOString() }
}

let fetchMock: ReturnType<typeof vi.fn>

function reponseJson(corps: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } }))
}

function simuler(data: { nonLues: number; notifications: ReturnType<typeof notif>[] }, lu: { nonLues: number } = { nonLues: 0 }) {
  fetchMock = vi.fn((url: string, init?: RequestInit) =>
    String(url).includes('/lu') ? reponseJson({ data: lu }) : (init, reponseJson({ data })))
  vi.stubGlobal('fetch', fetchMock)
}

async function ouvrir() {
  fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
  await screen.findByRole('dialog')
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ClocheNotifications', () => {
  it('affiche le compteur de non lues dans le libellé accessible', async () => {
    simuler({ nonLues: 3, notifications: [notif('a')] })
    render(<ClocheNotifications />)
    expect(await screen.findByRole('button', { name: /3 non lues/ })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('affiche « 99+ » au-delà de 99', async () => {
    simuler({ nonLues: 150, notifications: [] })
    render(<ClocheNotifications />)
    expect(await screen.findByText('99+')).toBeInTheDocument()
  })

  it('liste les notifications avec repère non lue et lien', async () => {
    simuler({ nonLues: 1, notifications: [notif('a'), notif('b', true, null)] })
    render(<ClocheNotifications />)
    await screen.findByText('1')
    await ouvrir()
    expect(await screen.findByText('Titre a')).toBeInTheDocument()
    expect(screen.getByText('Message b')).toBeInTheDocument()
    expect(screen.getAllByText(/Non lue/)).toHaveLength(1)
    const liens = screen.getAllByRole('link', { name: 'Ouvrir' })
    expect(liens).toHaveLength(1)
    expect(liens[0]).toHaveAttribute('href', '/tableaux/abc')
    expect(screen.getAllByRole('button', { name: 'Marquer comme lue' })).toHaveLength(1)
  })

  it('marque une notification lue de façon optimiste', async () => {
    simuler({ nonLues: 1, notifications: [notif('a')] })
    render(<ClocheNotifications />)
    await screen.findByText('1')
    await ouvrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Marquer comme lue' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Marquer comme lue' })).toBeNull())
    const appel = fetchMock.mock.calls.find(([url]) => String(url).includes('/lu'))
    expect(appel?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ id: 'a' }) })
    expect(screen.getByRole('button', { name: /aucune non lue/ })).toBeInTheDocument()
  })

  it('marque tout comme lu', async () => {
    simuler({ nonLues: 2, notifications: [notif('a'), notif('b')] })
    render(<ClocheNotifications />)
    await screen.findByText('2')
    await ouvrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Tout marquer comme lu' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tout marquer comme lu' })).toBeNull())
    const appel = fetchMock.mock.calls.find(([url]) => String(url).includes('/lu'))
    expect(appel?.[1]).toMatchObject({ body: JSON.stringify({ tous: true }) })
  })

  it('cliquer le lien marque la notification lue', async () => {
    simuler({ nonLues: 1, notifications: [notif('a')] })
    render(<ClocheNotifications />)
    await screen.findByText('1')
    await ouvrir()
    fireEvent.click(await screen.findByRole('link', { name: 'Ouvrir' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/lu'))).toBe(true))
  })

  it('affiche l’état vide', async () => {
    simuler({ nonLues: 0, notifications: [] })
    render(<ClocheNotifications />)
    await ouvrir()
    expect(await screen.findByText('Aucune notification pour l’instant.')).toBeInTheDocument()
  })

  it('affiche l’erreur avec un bouton Réessayer', async () => {
    fetchMock = vi.fn(() => reponseJson({ error: 'x' }, 500))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClocheNotifications />)
    await ouvrir()
    expect(await screen.findByText('Impossible de charger les notifications.')).toBeInTheDocument()
    simuler({ nonLues: 0, notifications: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Aucune notification pour l’instant.')).toBeInTheDocument()
  })

  it('ignore silencieusement une réponse 401', async () => {
    fetchMock = vi.fn(() => reponseJson({ error: 'Unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClocheNotifications />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByText('99+')).toBeNull()
    await ouvrir()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('n’affiche que ce que renvoie l’API (aucune notification d’autrui)', async () => {
    simuler({ nonLues: 1, notifications: [notif('a')] })
    render(<ClocheNotifications />)
    await screen.findByText('1')
    await ouvrir()
    await screen.findByText('Titre a')
    expect(screen.queryByText('Titre autrui')).toBeNull()
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('userId'))).toBe(true)
  })
})
