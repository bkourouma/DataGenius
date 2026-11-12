import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CarteArtefact } from '@/components/medic-assist/artefacts/carte-artefact'
import type { TypeArtefact } from '@/lib/medic-assist/contrats'

import { artefactTest, reponseApi, reponseJson } from './_fixtures-artefacts-ui'
import { langueTest } from './_intl'

vi.mock('next-intl', async importOriginal =>
  (await import('./_fixtures-artefacts-ui')).mockIntlUi(await importOriginal())
)
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

function simulerApi(type: TypeArtefact = 'tableau') {
  const fetchMock = vi.fn(async () => reponseJson(reponseApi(artefactTest(type))))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function anglaisDisponible(): boolean {
  const fichier = resolve(process.cwd(), 'messages', 'en', 'medicAssistArtefacts.json')
  if (!existsSync(fichier)) return false
  const json = JSON.parse(readFileSync(fichier, 'utf8')) as { carte?: Record<string, unknown> }
  return Object.keys(json.carte ?? {}).length > 0
}

describe('CarteArtefact', () => {
  beforeEach(() => {
    langueTest.code = 'fr'
    vi.unstubAllGlobals()
  })

  it('affiche le titre, le type et un bouton Ouvrir au nom accessible clair', () => {
    simulerApi()
    render(
      <CarteArtefact artefactId="art-tableau" titre="CA par pays" type="tableau" onOuvrir={vi.fn()} />
    )
    expect(screen.getByText('CA par pays')).toBeInTheDocument()
    expect(screen.getByText('Tableau')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: "Ouvrir l'artefact CA par pays" })
    ).toBeInTheDocument()
  })

  it('ne charge rien tant que la carte n’est ni survolée ni focalisée', () => {
    const fetchMock = simulerApi()
    render(
      <CarteArtefact artefactId="art-tableau" titre="CA par pays" type="tableau" onOuvrir={vi.fn()} />
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('charge le résumé au survol, une seule fois', async () => {
    const fetchMock = simulerApi()
    render(
      <CarteArtefact artefactId="art-tableau" titre="CA par pays" type="tableau" onOuvrir={vi.fn()} />
    )
    const carte = screen.getByTestId('carte-artefact')
    await userEvent.hover(carte)
    expect(await screen.findByText('Tableau · 2 lignes')).toBeInTheDocument()
    await userEvent.unhover(carte)
    await userEvent.hover(carte)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('charge le résumé au focus clavier', async () => {
    const fetchMock = simulerApi('graphique')
    render(<CarteArtefact artefactId="art-graphique" titre="CA" type="graphique" onOuvrir={vi.fn()} />)
    await userEvent.tab()
    expect(await screen.findByText('Graphique · barres')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('résume les indicateurs par leur nombre', async () => {
    simulerApi('indicateurs')
    render(
      <CarteArtefact artefactId="art-indicateurs" titre="KPI" type="indicateurs" onOuvrir={vi.fn()} />
    )
    await userEvent.hover(screen.getByTestId('carte-artefact'))
    expect(await screen.findByText('1 indicateur')).toBeInTheDocument()
  })

  it('garde le libellé du type si le chargement échoue', async () => {
    const fetchMock = vi.fn(async () => reponseJson({ error: 'x' }, 500))
    vi.stubGlobal('fetch', fetchMock)
    render(<CarteArtefact artefactId="a" titre="Rapport" type="document" onOuvrir={vi.fn()} />)
    await userEvent.hover(screen.getByTestId('carte-artefact'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByText('Document')).toBeInTheDocument()
  })

  it('ouvre l’artefact au clic sur le bouton ou n’importe où sur la carte', async () => {
    simulerApi()
    const onOuvrir = vi.fn()
    render(<CarteArtefact artefactId="art-1" titre="CA par pays" type="tableau" onOuvrir={onOuvrir} />)
    await userEvent.click(screen.getByRole('button', { name: /Ouvrir/ }))
    expect(onOuvrir).toHaveBeenCalledTimes(1)
    expect(onOuvrir).toHaveBeenLastCalledWith('art-1')
    await userEvent.click(screen.getByText('CA par pays'))
    expect(onOuvrir).toHaveBeenCalledTimes(2)
  })

  it('ouvre l’artefact au clavier (Entrée puis Espace), une fois par appui', async () => {
    simulerApi()
    const onOuvrir = vi.fn()
    render(<CarteArtefact artefactId="art-1" titre="CA par pays" type="tableau" onOuvrir={onOuvrir} />)
    await userEvent.tab()
    expect(screen.getByRole('button', { name: /Ouvrir/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onOuvrir).toHaveBeenCalledTimes(1)
    await userEvent.keyboard(' ')
    expect(onOuvrir).toHaveBeenCalledTimes(2)
  })

  it('utilise des classes logiques et retourne la flèche en arabe', () => {
    langueTest.code = 'ar'
    simulerApi()
    const { container } = render(
      <CarteArtefact artefactId="a" titre="عنوان" type="tableau" onOuvrir={vi.fn()} />
    )
    expect(container.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/)
    expect(container.querySelector('svg.rtl\\:rotate-180')).not.toBeNull()
  })

  it.skipIf(!anglaisDisponible())('affiche l’interface en anglais', () => {
    langueTest.code = 'en'
    simulerApi()
    render(<CarteArtefact artefactId="a" titre="Sales" type="tableau" onOuvrir={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Open/ })).toBeInTheDocument()
    expect(screen.queryByText('Ouvrir')).not.toBeInTheDocument()
  })
})
