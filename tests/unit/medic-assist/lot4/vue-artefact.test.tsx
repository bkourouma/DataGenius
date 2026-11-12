import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { forwardRef, useImperativeHandle } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VueArtefact } from '@/components/medic-assist/artefacts/vue-artefact'
import type { ArtefactClient } from '@/lib/medic-assist/artefacts/types-rendu'

import { artefactTest, reponseApi, reponseJson } from './_fixtures-artefacts-ui'
import { langueTest } from './_intl'

vi.mock('next-intl', async importOriginal =>
  (await import('./_fixtures-artefacts-ui')).mockIntlUi(await importOriginal())
)

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  tableauProps: vi.fn(),
  graphiqueProps: vi.fn(),
  documentProps: vi.fn(),
  telechargerPng: vi.fn(),
  telechargerDepuisUrl: vi.fn(),
}))

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/lib/medic-assist/artefacts/telecharger', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/artefacts/telecharger')>()),
  telechargerDepuisUrl: mocks.telechargerDepuisUrl,
}))
vi.mock('@/components/medic-assist/artefacts/rendu-tableau', () => ({
  RenduTableau: forwardRef<unknown, { spec: { titre: string }; modifiable?: boolean }>(
    function RenduTableauFactice(props, ref) {
      mocks.tableauProps(props)
      useImperativeHandle(ref, () => ({ copierTsv: vi.fn(), modele: vi.fn() }))
      return (
        <div data-testid="rendu-tableau" data-modifiable={String(Boolean(props.modifiable))}>
          tableau
        </div>
      )
    }
  ),
}))
vi.mock('@/components/medic-assist/artefacts/rendu-graphique', () => ({
  RenduGraphique: forwardRef<unknown, { titre: string; modifiable?: boolean }>(
    function RenduGraphiqueFactice(props, ref) {
      mocks.graphiqueProps(props)
      useImperativeHandle(ref, () => ({
        telechargerPng: mocks.telechargerPng,
        versDataUrl: () => null,
      }))
      return <div data-testid="rendu-graphique" data-modifiable={String(Boolean(props.modifiable))} />
    }
  ),
}))
vi.mock('@/components/medic-assist/artefacts/rendu-indicateurs', () => ({
  RenduIndicateurs: () => <div data-testid="rendu-indicateurs" />,
}))
vi.mock('@/components/medic-assist/artefacts/rendu-document', () => ({
  RenduDocument: (props: { onSpecChange?: unknown }) => {
    mocks.documentProps(props)
    return <div data-testid="rendu-document">Texte du document</div>
  },
}))

interface Appel {
  url: string
  methode: string
}

function simulerApi(
  corps: (url: string) => Response | Promise<Response>
): { appels: Appel[] } {
  const appels: Appel[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      appels.push({ url, methode: init?.method ?? 'GET' })
      return corps(url)
    })
  )
  return { appels }
}

const servir = (a: ArtefactClient) => () => reponseJson(reponseApi(a))

describe('VueArtefact', () => {
  beforeEach(() => {
    langueTest.code = 'fr'
    for (const m of Object.values(mocks)) m.mockReset()
    mocks.telechargerPng.mockResolvedValue(undefined)
    mocks.telechargerDepuisUrl.mockResolvedValue(undefined)
  })

  // --- États ------------------------------------------------------------------

  it('affiche un squelette de hauteur stable pendant le chargement, puis le contenu', async () => {
    simulerApi(servir(artefactTest('tableau', { titre: 'CA par pays' })))
    const { container } = render(<VueArtefact artefactId="art-tableau" />)
    expect(screen.getByRole('status')).toHaveTextContent("Chargement de l'artefact")
    const squelette = container.querySelector('[aria-busy="true"] > div:last-child') as HTMLElement
    expect(squelette.style.height).toBe('320px')
    expect(await screen.findByTestId('rendu-tableau')).toBeInTheDocument()
  })

  it('le squelette compact garde la hauteur du graphique compact', () => {
    simulerApi(() => new Promise<Response>(() => {}))
    const { container } = render(<VueArtefact artefactId="art-graphique" compact />)
    const squelette = container.querySelector('[aria-busy="true"] > div:last-child') as HTMLElement
    expect(squelette.style.height).toBe('280px')
  })

  it('charge GET /api/medic-assist/artefacts/[id] sans PATCH', async () => {
    const { appels } = simulerApi(servir(artefactTest('tableau')))
    render(<VueArtefact artefactId="art-tableau" />)
    await screen.findByTestId('rendu-tableau')
    expect(appels).toEqual([{ url: '/api/medic-assist/artefacts/art-tableau', methode: 'GET' }])
  })

  it('demande la version voulue', async () => {
    const { appels } = simulerApi(servir(artefactTest('tableau', { version: 3 })))
    render(<VueArtefact artefactId="art-tableau" version={3} />)
    await screen.findByTestId('rendu-tableau')
    expect(appels[0].url).toBe('/api/medic-assist/artefacts/art-tableau?version=3')
  })

  it('erreur de chargement : message, Réessayer, puis contenu', async () => {
    let ok = false
    simulerApi(() =>
      ok ? reponseJson(reponseApi(artefactTest('tableau'))) : reponseJson({ error: 'x' }, 500)
    )
    render(<VueArtefact artefactId="art-tableau" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger cet artefact')
    ok = true
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByTestId('rendu-tableau')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('artefact introuvable : message dédié, sans bouton Réessayer', async () => {
    simulerApi(() => reponseJson({ error: 'NotFound' }, 404))
    render(<VueArtefact artefactId="art-inconnu" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('introuvable')
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument()
  })

  it('document sans bloc : état vide', async () => {
    simulerApi(
      servir(
        artefactTest('document', {
          spec: { type: 'document', titre: 'Rapport', blocs: [] },
        })
      )
    )
    render(<VueArtefact artefactId="art-document" />)
    expect(await screen.findByText('Cet artefact ne contient rien à afficher.')).toBeInTheDocument()
    expect(screen.queryByTestId('rendu-document')).not.toBeInTheDocument()
  })

  // --- Mode normal ------------------------------------------------------------

  it('mode normal : région nommée, titre, sous-titre, menu Télécharger, aucun chrome du panneau', async () => {
    simulerApi(servir(artefactTest('tableau', { titre: 'CA par pays', sousTitre: 'Avril à octobre' })))
    render(<VueArtefact artefactId="art-tableau" />)
    const region = await screen.findByRole('region', { name: 'CA par pays' })
    expect(within(region).getByRole('heading', { level: 3, name: 'CA par pays' })).toBeInTheDocument()
    expect(within(region).getByText('Avril à octobre')).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: /Télécharger/ })).toBeInTheDocument()
    // Ni versions, ni onglets, ni copie, ni provenance, ni actions.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Comment j'ai calculé/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copier/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Version/)).not.toBeInTheDocument()
    expect(mocks.tableauProps.mock.lastCall?.[0].hauteurMax).toBeUndefined()
  })

  it('lecture seule : le rendu reçoit modifiable faux même pour le propriétaire, sans écriture', async () => {
    const { appels } = simulerApi(servir(artefactTest('graphique', { modifiable: true })))
    render(<VueArtefact artefactId="art-graphique" />)
    const rendu = await screen.findByTestId('rendu-graphique')
    expect(rendu).toHaveAttribute('data-modifiable', 'false')
    const props = mocks.graphiqueProps.mock.lastCall?.[0] as { onSpecChange?: (s: unknown) => void }
    props.onSpecChange?.({ forme: 'lignes' })
    await new Promise(r => setTimeout(r, 900))
    expect(appels.every(a => a.methode === 'GET')).toBe(true)
  })

  it('télécharge par le serveur (format Excel) depuis le menu', async () => {
    simulerApi(servir(artefactTest('tableau', { titre: 'CA par pays' })))
    render(<VueArtefact artefactId="art-tableau" />)
    await screen.findByTestId('rendu-tableau')
    await userEvent.click(screen.getByRole('button', { name: /Télécharger/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Excel/ }))
    await waitFor(() => expect(mocks.telechargerDepuisUrl).toHaveBeenCalledTimes(1))
    expect(String(mocks.telechargerDepuisUrl.mock.calls[0][0])).toContain(
      '/api/medic-assist/artefacts/art-tableau/export'
    )
  })

  it('graphique : le menu propose l’image PNG et passe par le rendu', async () => {
    simulerApi(servir(artefactTest('graphique', { titre: 'Courbe' })))
    render(<VueArtefact artefactId="art-graphique" />)
    await screen.findByTestId('rendu-graphique')
    await userEvent.click(screen.getByRole('button', { name: /Télécharger/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /PNG/ }))
    await waitFor(() => expect(mocks.telechargerPng).toHaveBeenCalledWith('Courbe'))
  })

  it('tableau : pas d’entrée PNG (pas de poignée de graphique)', async () => {
    simulerApi(servir(artefactTest('tableau')))
    render(<VueArtefact artefactId="art-tableau" />)
    await screen.findByTestId('rendu-tableau')
    await userEvent.click(screen.getByRole('button', { name: /Télécharger/ }))
    await screen.findByRole('menuitem', { name: /Excel/ })
    expect(screen.queryByRole('menuitem', { name: /PNG/ })).not.toBeInTheDocument()
  })

  // --- Mode compact -----------------------------------------------------------

  it('compact : titre seul (sans sous-titre), graphique de 280 px', async () => {
    simulerApi(servir(artefactTest('graphique', { titre: 'Courbe', sousTitre: 'Mensuel' })))
    render(<VueArtefact artefactId="art-graphique" compact />)
    const region = await screen.findByRole('region', { name: 'Courbe' })
    expect(within(region).queryByText('Mensuel')).not.toBeInTheDocument()
    const props = mocks.graphiqueProps.mock.lastCall?.[0] as { compact?: boolean; hauteur?: number }
    expect(props.compact).toBe(true)
    expect(props.hauteur).toBe(280)
    expect(region).toHaveAttribute('data-compact', 'true')
  })

  it('compact : tableau à hauteur limitée (défilement)', async () => {
    simulerApi(servir(artefactTest('tableau')))
    render(<VueArtefact artefactId="art-tableau" compact />)
    await screen.findByTestId('rendu-tableau')
    const hauteur = mocks.tableauProps.mock.lastCall?.[0].hauteurMax as number
    expect(hauteur).toBeGreaterThan(0)
    expect(hauteur).toBeLessThanOrEqual(360)
  })

  it('compact : document tronqué avec dégradé ; normal : ni troncature ni dégradé', async () => {
    simulerApi(servir(artefactTest('document')))
    const { container, unmount } = render(<VueArtefact artefactId="art-document" compact />)
    await screen.findByTestId('rendu-document')
    expect(screen.getByTestId('degrade-apercu')).toBeInTheDocument()
    const zone = screen.getByTestId('rendu-document').parentElement as HTMLElement
    expect(zone.style.maxHeight).toBe('280px')
    expect(zone).toHaveClass('overflow-hidden')
    expect(container.querySelector('[data-compact]')).not.toBeNull()
    unmount()

    simulerApi(servir(artefactTest('document')))
    render(<VueArtefact artefactId="art-document" />)
    await screen.findByTestId('rendu-document')
    expect(screen.queryByTestId('degrade-apercu')).not.toBeInTheDocument()
    expect((screen.getByTestId('rendu-document').parentElement as HTMLElement).style.maxHeight).toBe('')
  })

  it('compact : la barre d’outils se réduit au menu Télécharger', async () => {
    simulerApi(servir(artefactTest('tableau')))
    render(<VueArtefact artefactId="art-tableau" compact />)
    await screen.findByTestId('rendu-tableau')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Télécharger/ })).toBeInTheDocument()
  })

  it('indicateurs : rendus sans édition', async () => {
    simulerApi(servir(artefactTest('indicateurs')))
    render(<VueArtefact artefactId="art-indicateurs" compact />)
    expect(await screen.findByTestId('rendu-indicateurs')).toBeInTheDocument()
  })

  // --- Langues, RTL, mobile ---------------------------------------------------

  it('arabe : titre en dir=auto et classes logiques (aucun left/right)', async () => {
    langueTest.code = 'ar'
    simulerApi(servir(artefactTest('tableau', { titre: 'مبيعات الدول' })))
    const { container } = render(<VueArtefact artefactId="art-tableau" />)
    const titre = await screen.findByRole('heading', { level: 3, name: 'مبيعات الدول' })
    expect(titre).toHaveAttribute('dir', 'auto')
    expect(container.innerHTML).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-/)
  })

  it('375 px : le contenu peut rétrécir (min-w-0) et la barre se replie (flex-wrap)', async () => {
    simulerApi(servir(artefactTest('tableau')))
    render(<VueArtefact artefactId="art-tableau" />)
    const region = await screen.findByRole('region')
    expect(region).toHaveClass('min-w-0')
    expect(region.firstElementChild).toHaveClass('flex-wrap')
  })
})
