import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { forwardRef, useImperativeHandle } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PanneauArtefacts } from '@/components/medic-assist/artefacts/panneau-artefacts'
import type { TypeArtefact } from '@/lib/medic-assist/contrats'
import type { ArtefactClient } from '@/lib/medic-assist/artefacts/types-rendu'

import { artefactTest, jeuTest, provenanceTest, reponseApi, reponseJson } from './_fixtures-artefacts-ui'
import { langueTest } from './_intl'

vi.mock('next-intl', async importOriginal =>
  (await import('./_fixtures-artefacts-ui')).mockIntlUi(await importOriginal())
)

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  copierTsv: vi.fn(),
  telechargerPng: vi.fn(),
  telechargerDepuisUrl: vi.fn(),
  tableauProps: vi.fn(),
  graphiqueProps: vi.fn(),
  role: { valeur: 'RegManager' as string | undefined },
}))

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'u1', roleName: mocks.role.valeur } },
    status: 'authenticated',
  }),
}))
vi.mock('@/lib/medic-assist/artefacts/telecharger', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/artefacts/telecharger')>()),
  telechargerDepuisUrl: mocks.telechargerDepuisUrl,
}))
vi.mock('@/components/medic-assist/suivi/actions-artefact', () => ({
  ActionsArtefact: () => <div data-testid="actions-artefact" />,
}))
vi.mock('@/components/medic-assist/artefacts/rendu-tableau', () => ({
  RenduTableau: forwardRef<unknown, { spec: { titre: string }; modifiable?: boolean }>(
    function RenduTableauFactice(props, ref) {
      mocks.tableauProps(props)
      useImperativeHandle(ref, () => ({ copierTsv: mocks.copierTsv, modele: vi.fn() }))
      return (
        <div data-testid="rendu-tableau" data-modifiable={String(Boolean(props.modifiable))}>
          {props.spec.titre}
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
      return (
        <div data-testid="rendu-graphique" data-modifiable={String(Boolean(props.modifiable))}>
          {props.titre}
        </div>
      )
    }
  ),
}))
vi.mock('@/components/medic-assist/artefacts/rendu-indicateurs', () => ({
  RenduIndicateurs: () => <div data-testid="rendu-indicateurs" />,
}))
vi.mock('@/components/medic-assist/artefacts/rendu-document', () => ({
  RenduDocument: () => <div data-testid="rendu-document" />,
}))

// ---------------------------------------------------------------------------
// API simulée
// ---------------------------------------------------------------------------

interface Liste {
  id: string
  racineId: string
  version: number
  type: TypeArtefact
  titre: string
  majA: string
}

function resume(type: TypeArtefact, titre: string): Liste {
  return { id: `art-${type}`, racineId: `art-${type}`, version: 1, type, titre, majA: '2026-11-02T08:00:00.000Z' }
}

interface Api {
  liste: Liste[]
  artefacts: Record<string, ArtefactClient>
  urls: string[]
}

function simulerApi(api: Partial<Api> = {}): Api {
  const complet: Api = {
    liste: [resume('tableau', 'CA par pays'), resume('graphique', 'Courbe des ventes')],
    artefacts: {
      'art-tableau': artefactTest('tableau', { titre: 'CA par pays' }),
      'art-graphique': artefactTest('graphique', { titre: 'Courbe des ventes' }),
    },
    urls: [],
    ...api,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      complet.urls.push(url)
      if (url.startsWith('/api/medic-assist/artefacts?')) return reponseJson({ artefacts: complet.liste })
      const [chemin, requete] = url.replace('/api/medic-assist/artefacts/', '').split('?')
      const artefact = complet.artefacts[chemin]
      if (!artefact) return reponseJson({ error: 'NotFound' }, 404)
      const version = new URLSearchParams(requete ?? '').get('version')
      return reponseJson(reponseApi(version ? { ...artefact, version: Number(version) } : artefact))
    })
  )
  return complet
}

function monter(props: Partial<React.ComponentProps<typeof PanneauArtefacts>> = {}) {
  const proprietes = {
    conversationId: 'conv-1',
    artefactActifId: 'art-tableau' as string | null,
    onFermer: vi.fn(),
    onSelection: vi.fn(),
    ...props,
  }
  return { ...render(<PanneauArtefacts {...proprietes} />), props: proprietes }
}

function anglaisDisponible(): boolean {
  const fichier = resolve(process.cwd(), 'messages', 'en', 'medicAssistArtefacts.json')
  if (!existsSync(fichier)) return false
  const json = JSON.parse(readFileSync(fichier, 'utf8')) as { panneau?: Record<string, unknown> }
  return Object.keys(json.panneau ?? {}).length > 0
}

describe('PanneauArtefacts', () => {
  beforeEach(() => {
    langueTest.code = 'fr'
    mocks.role.valeur = 'RegManager'
    for (const m of [
      mocks.toast,
      mocks.copierTsv,
      mocks.telechargerPng,
      mocks.telechargerDepuisUrl,
      mocks.tableauProps,
      mocks.graphiqueProps,
    ])
      m.mockReset()
    mocks.copierTsv.mockResolvedValue(true)
    mocks.telechargerPng.mockResolvedValue(undefined)
    mocks.telechargerDepuisUrl.mockResolvedValue(undefined)
  })

  // --- États ------------------------------------------------------------------

  it('affiche des squelettes pendant le chargement puis le contenu', async () => {
    simulerApi()
    monter()
    expect(screen.getAllByRole('status', { busy: true }).length).toBeGreaterThan(0)
    expect(await screen.findByTestId('rendu-tableau')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'CA par pays' })).toBeInTheDocument()
  })

  it("affiche le texte guide quand la conversation n'a aucun artefact", async () => {
    simulerApi({ liste: [] })
    monter({ artefactActifId: null })
    expect(await screen.findByText("Aucun artefact pour l'instant")).toBeInTheDocument()
    expect(screen.getByText(/Demandez un tableau/)).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('propose Réessayer après une erreur de chargement', async () => {
    const api = simulerApi()
    delete api.artefacts['art-tableau']
    monter()
    expect(await screen.findByRole('alert')).toHaveTextContent('introuvable')
    api.artefacts['art-tableau'] = artefactTest('tableau', { titre: 'CA par pays' })
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByTestId('rendu-tableau')).toBeInTheDocument()
  })

  it("propose Réessayer quand la liste des artefacts ne se charge pas", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reponseJson({ error: 'x' }, 500)))
    monter({ artefactActifId: null })
    expect(await screen.findByRole('alert')).toHaveTextContent('liste des artefacts')
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })

  it('affiche une erreur traduite si le jeu de données manque', async () => {
    simulerApi({ artefacts: { 'art-tableau': artefactTest('tableau', { jeux: {} }) } })
    monter()
    expect(await screen.findByRole('alert')).toHaveTextContent('données de cet artefact')
  })

  // --- Onglets ----------------------------------------------------------------

  it('liste les artefacts en onglets, marque l’actif et appelle onSelection au clic', async () => {
    simulerApi()
    const { props } = monter()
    const onglets = await screen.findAllByRole('tab')
    expect(onglets.map(o => o.textContent)).toEqual(['CA par pays', 'Courbe des ventes'])
    expect(onglets[0]).toHaveAttribute('aria-selected', 'true')
    expect(onglets[1]).toHaveAttribute('aria-selected', 'false')
    expect(onglets[1]).toHaveAttribute('title', 'Courbe des ventes')

    await userEvent.click(onglets[1])
    expect(props.onSelection).toHaveBeenCalledWith('art-graphique')
  })

  it('suit artefactActifId et lit le dernier artefact quand il est nul', async () => {
    simulerApi()
    monter({ artefactActifId: null })
    expect(await screen.findByTestId('rendu-graphique')).toBeInTheDocument()
    expect((await screen.findAllByRole('tab'))[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('navigue entre onglets aux flèches, Début et Fin', async () => {
    simulerApi()
    const { props } = monter()
    const onglets = await screen.findAllByRole('tab')
    onglets[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(props.onSelection).toHaveBeenLastCalledWith('art-graphique')
    await userEvent.keyboard('{ArrowLeft}')
    expect(props.onSelection).toHaveBeenLastCalledWith('art-graphique') // cyclique : 0 - 1 = dernier
    await userEvent.keyboard('{End}')
    expect(props.onSelection).toHaveBeenLastCalledWith('art-graphique')
    await userEvent.keyboard('{Home}')
    expect(props.onSelection).toHaveBeenLastCalledWith('art-tableau')
  })

  it('inverse les flèches en arabe (écriture de droite à gauche)', async () => {
    langueTest.code = 'ar'
    simulerApi()
    const { props } = monter()
    const onglets = await screen.findAllByRole('tab')
    onglets[0].focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(props.onSelection).toHaveBeenLastCalledWith('art-graphique')
    expect(document.body.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\w/)
  })

  // --- Versions ---------------------------------------------------------------

  const deuxVersions = {
    version: 2,
    versions: [
      { version: 1, creeLe: '2026-11-02T08:00:00.000Z' },
      { version: 2, creeLe: '2026-11-02T09:00:00.000Z' },
    ],
  }

  it('propose les versions (la courante marquée) et lit une ancienne en lecture seule', async () => {
    const api = simulerApi({
      artefacts: {
        'art-tableau': artefactTest('tableau', { titre: 'CA par pays', ...deuxVersions }),
      },
    })
    monter()
    const selecteur = await screen.findByRole('combobox', { name: 'Version' })
    const options = within(selecteur).getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual([
      expect.stringMatching(/^v2 · .*\(actuelle\)$/),
      expect.stringMatching(/^v1 · /),
    ])
    expect(screen.getByTestId('rendu-tableau')).toHaveAttribute('data-modifiable', 'true')
    expect(screen.queryByText(/lecture seule/)).not.toBeInTheDocument()

    await userEvent.selectOptions(selecteur, '1')
    await waitFor(() =>
      expect(api.urls).toContain('/api/medic-assist/artefacts/art-tableau?version=1')
    )
    expect(await screen.findByText('Vous consultez la version 1, en lecture seule.')).toBeInTheDocument()
    expect(screen.getByTestId('rendu-tableau')).toHaveAttribute('data-modifiable', 'false')

    await userEvent.click(screen.getByRole('button', { name: 'Revenir à la dernière' }))
    await waitFor(() =>
      expect(screen.queryByText(/Vous consultez la version/)).not.toBeInTheDocument()
    )
    expect(await screen.findByTestId('rendu-tableau')).toHaveAttribute('data-modifiable', 'true')
  })

  it("n'affiche pas de sélecteur pour une version unique et marque la lecture seule d'un autre lecteur", async () => {
    simulerApi({
      artefacts: { 'art-tableau': artefactTest('tableau', { modifiable: false }) },
    })
    monter()
    await screen.findByTestId('rendu-tableau')
    expect(screen.queryByRole('combobox', { name: 'Version' })).not.toBeInTheDocument()
    expect(screen.getByText('Lecture seule')).toBeInTheDocument()
  })

  // --- Barre d'outils ---------------------------------------------------------

  it('télécharge via l’URL d’export de l’artefact affiché', async () => {
    simulerApi()
    monter()
    await screen.findByTestId('rendu-tableau')
    await userEvent.click(screen.getByRole('button', { name: 'Télécharger' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'PDF (.pdf)' }))
    await waitFor(() => expect(mocks.telechargerDepuisUrl).toHaveBeenCalled())
    expect(mocks.telechargerDepuisUrl).toHaveBeenCalledWith(
      '/api/medic-assist/artefacts/art-tableau/export?format=pdf&version=1',
      'CA par pays.pdf'
    )
    expect(screen.queryByRole('menuitem', { name: 'Image PNG (.png)' })).not.toBeInTheDocument()
  })

  it('télécharge un graphique en PNG par le rendu, puis masque PNG en vue Tableau', async () => {
    simulerApi()
    monter({ artefactActifId: 'art-graphique' })
    await screen.findByTestId('rendu-graphique')
    await userEvent.click(screen.getByRole('button', { name: 'Télécharger' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Image PNG (.png)' }))
    await waitFor(() => expect(mocks.telechargerPng).toHaveBeenCalledWith('Courbe des ventes'))

    await userEvent.click(screen.getByRole('button', { name: 'Tableau' }))
    expect(await screen.findByTestId('rendu-tableau')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Télécharger' }))
    await screen.findByRole('menuitem', { name: 'PDF (.pdf)' })
    expect(screen.queryByRole('menuitem', { name: 'Image PNG (.png)' })).not.toBeInTheDocument()
  })

  it('bascule Graphique / Tableau avec les mêmes données, en lecture seule', async () => {
    simulerApi()
    monter({ artefactActifId: 'art-graphique' })
    await screen.findByTestId('rendu-graphique')
    expect(screen.getByRole('button', { name: 'Graphique' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Tableau' }))
    expect(await screen.findByTestId('rendu-tableau')).toHaveAttribute('data-modifiable', 'false')
    expect(mocks.tableauProps).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({ jeuDeDonneesId: 'jeu-1', totaux: false }),
      })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Graphique' }))
    expect(await screen.findByTestId('rendu-graphique')).toBeInTheDocument()
  })

  it('copie le tableau en TSV (tableau seulement) et le signale', async () => {
    simulerApi()
    monter()
    await screen.findByTestId('rendu-tableau')
    await userEvent.click(screen.getByRole('button', { name: 'Copier' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled())
    expect(mocks.copierTsv).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'Tableau copié, prêt à coller dans Excel' })
  })

  it("signale l'échec de la copie", async () => {
    mocks.copierTsv.mockResolvedValue(false)
    simulerApi()
    monter()
    await screen.findByTestId('rendu-tableau')
    await userEvent.click(screen.getByRole('button', { name: 'Copier' }))
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive', title: 'La copie a échoué' })
      )
    )
  })

  it('ne propose pas Copier pour un graphique en vue native', async () => {
    simulerApi()
    monter({ artefactActifId: 'art-graphique' })
    await screen.findByTestId('rendu-graphique')
    expect(screen.queryByRole('button', { name: 'Copier' })).not.toBeInTheDocument()
  })

  it("place les actions du lot 5 dans la barre d'outils", async () => {
    simulerApi()
    monter()
    expect(await screen.findByTestId('actions-artefact')).toBeInTheDocument()
  })

  it('ferme le panneau', async () => {
    simulerApi()
    const { props } = monter()
    await screen.findByTestId('rendu-tableau')
    await userEvent.click(screen.getByRole('button', { name: 'Fermer le panneau' }))
    expect(props.onFermer).toHaveBeenCalledTimes(1)
  })

  // --- Plein écran ------------------------------------------------------------

  it('passe en plein écran puis revient avec Échap, focus rendu au bouton', async () => {
    simulerApi()
    monter()
    await screen.findByTestId('rendu-tableau')
    const region = screen.getByRole('region', { name: 'Panneau des artefacts' })
    expect(region.className).not.toMatch(/(^|\s)fixed(\s|$)/)

    const bouton = screen.getByRole('button', { name: 'Agrandir le panneau' })
    await userEvent.click(bouton)
    const dialogue = screen.getByRole('dialog', { name: 'Panneau des artefacts en plein écran' })
    expect(dialogue).toHaveAttribute('aria-modal', 'true')
    expect(dialogue.className).toMatch(/(^|\s)fixed(\s|$)/)
    expect(dialogue.className).toMatch(/inset-0/)
    expect(screen.getByRole('button', { name: 'Réduire le panneau' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Panneau des artefacts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agrandir le panneau' })).toHaveFocus()
  })

  it('garde le focus dans le panneau plein écran (Tab circulaire)', async () => {
    simulerApi()
    monter()
    await screen.findByTestId('rendu-tableau')
    await userEvent.click(screen.getByRole('button', { name: 'Agrandir le panneau' }))
    const dialogue = screen.getByRole('dialog')
    const focusables = Array.from(
      dialogue.querySelectorAll<HTMLElement>('button:not([disabled]), select, [tabindex="0"]')
    )
    const dernier = focusables[focusables.length - 1]
    dernier.focus()
    await userEvent.tab()
    expect(dialogue.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(focusables[0])
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(dernier)
  })

  // --- Provenance -------------------------------------------------------------

  it("ouvre « Comment j'ai calculé » avec une provenance par jeu référencé", async () => {
    const second = jeuTest('jeu-2', provenanceTest({ libelleSource: 'Budgets annuels' }))
    simulerApi({
      artefacts: {
        'art-indicateurs': artefactTest('indicateurs', {
          titre: 'KPI',
          spec: {
            type: 'indicateurs',
            titre: 'KPI',
            cartes: [
              { libelle: 'CA', source: { jeuDeDonneesId: 'jeu-1', colonne: 'ca' } },
              { libelle: 'Budget', source: { jeuDeDonneesId: 'jeu-2', colonne: 'ca' } },
            ],
          },
          jeux: { 'jeu-1': jeuTest('jeu-1'), 'jeu-2': second },
        }),
      },
      liste: [resume('indicateurs', 'KPI')],
    })
    monter({ artefactActifId: 'art-indicateurs' })
    await screen.findByTestId('rendu-indicateurs')
    const bouton = screen.getByRole('button', { name: /Comment j'ai calculé/ })
    expect(bouton).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(bouton)
    expect(bouton).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('Ventes mensuelles')).toBeInTheDocument()
    expect(screen.getByText('Budgets annuels')).toBeInTheDocument()
    expect(screen.getByText('Jeu de données 1 sur 2')).toBeInTheDocument()
    expect(screen.getByText('Jeu de données 2 sur 2')).toBeInTheDocument()
  })

  it('réserve le SQL aux administrateurs de la session', async () => {
    const avecSql = jeuTest('jeu-1', provenanceTest({ sql: 'SELECT 1 FROM ventes' }))
    simulerApi({
      artefacts: { 'art-tableau': artefactTest('tableau', { jeux: { 'jeu-1': avecSql } }) },
    })

    mocks.role.valeur = 'CountryLead'
    const premier = monter()
    await screen.findByTestId('rendu-tableau')
    await userEvent.click(screen.getByRole('button', { name: /Comment j'ai calculé/ }))
    await screen.findByText('Ventes mensuelles')
    expect(screen.queryByText('SELECT 1 FROM ventes')).not.toBeInTheDocument()
    premier.unmount()

    mocks.role.valeur = 'TenantAdmin'
    simulerApi({
      artefacts: { 'art-tableau': artefactTest('tableau', { jeux: { 'jeu-1': avecSql } }) },
    })
    monter()
    await screen.findByTestId('rendu-tableau')
    await userEvent.click(screen.getByRole('button', { name: /Comment j'ai calculé/ }))
    expect(await screen.findByText('SELECT 1 FROM ventes')).toBeInTheDocument()
  })

  // --- Indicateur d'enregistrement --------------------------------------------

  it("annonce l'enregistrement dans une zone aria-live polie", async () => {
    simulerApi()
    monter()
    await screen.findByTestId('rendu-tableau')
    const zone = screen
      .getAllByRole('status')
      .find(el => el.getAttribute('aria-live') === 'polite')
    expect(zone).toBeDefined()
  })

  it("envoie les éditions du rendu en PATCH anti-rebond et affiche « Enregistré »", async () => {
    simulerApi()
    monter()
    await screen.findByTestId('rendu-tableau')
    const dernier = () => mocks.tableauProps.mock.lastCall?.[0] as {
      onSpecChange: (spec: unknown) => void
    }
    act(() => dernier().onSpecChange({ titre: 'Édité', jeuDeDonneesId: 'jeu-1' }))
    expect(await screen.findByText('Enregistrement…')).toBeInTheDocument()
    await waitFor(
      () => {
        const patchs = vi
          .mocked(fetch)
          .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
        expect(patchs).toHaveLength(1)
        expect(JSON.parse(String((patchs[0][1] as RequestInit).body))).toEqual({
          spec: { type: 'tableau', titre: 'Édité', jeuDeDonneesId: 'jeu-1' },
          versionAttendue: 1,
        })
      },
      { timeout: 3000 }
    )
    expect(await screen.findByText('Enregistré')).toBeInTheDocument()
  })

  it.skipIf(!anglaisDisponible())('affiche l’interface en anglais', async () => {
    langueTest.code = 'en'
    simulerApi()
    monter()
    await screen.findByTestId('rendu-tableau')
    expect(screen.queryByRole('button', { name: 'Fermer le panneau' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Close/i })).toBeInTheDocument()
  })
})
