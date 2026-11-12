import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { RenduDocument } from '@/components/medic-assist/artefacts/rendu-document'

import type {
  ArtefactDocument,
  BlocDocument,
  ColonneJeu,
} from '@/lib/medic-assist/contrats'
import type { ArtefactClient, JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

vi.mock('next-intl', async importOriginal =>
  (await import('./_intl')).mockNextIntl(await importOriginal())
)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const colonnes: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'ca', libelle: 'CA', type: 'montant' },
]

function jeu(id: string): JeuClient {
  return {
    jeuDeDonneesId: id,
    colonnes,
    lignes: [
      { pays: 'Mali', ca: 300 },
      { pays: 'Ghana', ca: 100 },
    ],
    nbLignes: 2,
    tronque: false,
    provenance: {
      source: 'semantique',
      libelleSource: 'Ventes',
      perimetre: { pays: 'tous', libelle: 'Tous' },
      filtres: [],
      regles: [],
      calculeA: '2026-11-02T00:00:00Z',
    },
  }
}

function artefact(partiel: Partial<ArtefactClient> & { blocs: BlocDocument[] }): ArtefactClient {
  const { blocs, ...reste } = partiel
  const spec: ArtefactDocument = { type: 'document', titre: 'Rapport', blocs }
  return {
    id: 'doc1',
    racineId: 'doc1',
    version: 1,
    versions: [{ version: 1, creeLe: '2026-11-02T00:00:00Z' }],
    type: 'document',
    titre: 'Rapport',
    spec,
    jeux: { j1: jeu('j1') },
    conversationId: null,
    creeLe: '2026-11-02T00:00:00Z',
    modifiable: false,
    ...reste,
  }
}

const renduGraphique = vi.fn(({ titre }: { titre: string }) => (
  <div data-testid="graphique">{`graphique:${titre}`}</div>
))

describe('RenduDocument', () => {
  it('rend les blocs dans l’ordre', () => {
    const a = artefact({
      blocs: [
        { type: 'texte', markdown: 'Premier paragraphe' },
        { type: 'tableau', spec: { titre: 'Tableau ventes', jeuDeDonneesId: 'j1' } },
        {
          type: 'graphique',
          spec: {
            titre: 'Courbe CA',
            jeuDeDonneesId: 'j1',
            graphique: { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] },
          },
        },
        { type: 'texte', markdown: 'Dernier paragraphe' },
      ],
    })
    render(<RenduDocument artefact={a} renduGraphique={renduGraphique} />)
    const blocs = Array.from(document.querySelectorAll('[data-bloc]')).map(b =>
      b.getAttribute('data-bloc')
    )
    expect(blocs).toEqual(['texte', 'tableau', 'graphique', 'texte'])
    const texte = document.body.textContent ?? ''
    expect(texte.indexOf('Premier paragraphe')).toBeLessThan(texte.indexOf('Tableau ventes'))
    expect(texte.indexOf('Tableau ventes')).toBeLessThan(texte.indexOf('graphique:Courbe CA'))
    expect(texte.indexOf('graphique:Courbe CA')).toBeLessThan(texte.indexOf('Dernier paragraphe'))
    expect(screen.getByText('Mali')).toBeInTheDocument()
  })

  it('rend un tableau lié avec RenduTableau et un graphique lié avec le rendu injecté', () => {
    const a = artefact({
      blocs: [
        { type: 'artefact', artefactId: 't1' },
        { type: 'artefact', artefactId: 'g1' },
      ],
      artefactsLies: {
        t1: {
          ...artefact({ blocs: [] }),
          id: 't1',
          type: 'tableau',
          titre: 'Ventes liées',
          spec: { type: 'tableau', titre: 'Ventes liées', jeuDeDonneesId: 'jt' },
          jeux: { jt: jeu('jt') },
        },
        g1: {
          ...artefact({ blocs: [] }),
          id: 'g1',
          type: 'graphique',
          titre: 'Graphique lié',
          spec: {
            type: 'graphique',
            titre: 'Graphique lié',
            jeuDeDonneesId: 'jg',
            graphique: { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] },
          },
          jeux: { jg: jeu('jg') },
        },
      },
    })
    render(<RenduDocument artefact={a} renduGraphique={renduGraphique} />)
    expect(screen.getByRole('heading', { name: 'Ventes liées' })).toBeInTheDocument()
    expect(screen.getByText('Ghana')).toBeInTheDocument()
    expect(screen.getByTestId('graphique')).toHaveTextContent('graphique:Graphique lié')
    expect(renduGraphique).toHaveBeenCalledWith(
      expect.objectContaining({ jeu: expect.objectContaining({ jeuDeDonneesId: 'jg' }) })
    )
  })

  it('rend des indicateurs liés avec le rendu optionnel', () => {
    const renduIndicateurs = vi.fn(() => <div data-testid="indicateurs" />)
    const a = artefact({
      blocs: [{ type: 'artefact', artefactId: 'i1' }],
      artefactsLies: {
        i1: {
          ...artefact({ blocs: [] }),
          id: 'i1',
          type: 'indicateurs',
          titre: 'KPI',
          spec: {
            type: 'indicateurs',
            titre: 'KPI',
            cartes: [{ libelle: 'CA', source: { jeuDeDonneesId: 'j1', colonne: 'ca' } }],
          },
        },
      },
    })
    render(
      <RenduDocument
        artefact={a}
        renduGraphique={renduGraphique}
        renduIndicateurs={renduIndicateurs}
      />
    )
    expect(screen.getByTestId('indicateurs')).toBeInTheDocument()
    expect(renduIndicateurs).toHaveBeenCalledWith(
      expect.objectContaining({ cartes: expect.any(Array), jeux: expect.any(Object) })
    )
  })

  it('affiche « artefact indisponible » quand le lien manque, sans fuite', () => {
    const a = artefact({
      blocs: [{ type: 'artefact', artefactId: 'secret-id-42' }],
      artefactsLies: {},
    })
    render(<RenduDocument artefact={a} renduGraphique={renduGraphique} />)
    expect(screen.getByText('Artefact indisponible')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('secret-id-42')
  })

  it('résiste à un id piégé', () => {
    const a = artefact({ blocs: [{ type: 'artefact', artefactId: 'constructor' }] })
    render(<RenduDocument artefact={a} renduGraphique={renduGraphique} />)
    expect(screen.getByText('Artefact indisponible')).toBeInTheDocument()
  })

  it('un jeu manquant donne un encart indisponible pour un graphique', () => {
    const a = artefact({
      blocs: [
        {
          type: 'graphique',
          spec: {
            titre: 'Sans données',
            jeuDeDonneesId: 'absent',
            graphique: { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] },
          },
        },
      ],
    })
    render(<RenduDocument artefact={a} renduGraphique={renduGraphique} />)
    expect(
      screen.getByText('Les données de ce graphique ne sont pas disponibles.')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('graphique')).toBeNull()
  })

  it('neutralise les liens externes, garde les liens internes, retire images et HTML', () => {
    const a = artefact({
      blocs: [
        {
          type: 'texte',
          markdown:
            'Voir [le Mali](/pays/ml), [site](https://exemple.org/x), [js](javascript:alert(1)), [proto](//evil.test) ![logo](http://evil.test/i.png) <b>gras</b> fin',
        },
      ],
    })
    render(<RenduDocument artefact={a} renduGraphique={renduGraphique} />)
    const liens = screen.getAllByRole('link')
    expect(liens).toHaveLength(1)
    expect(liens[0]).toHaveAttribute('href', '/pays/ml')
    expect(liens[0]).not.toHaveAttribute('target')
    expect(screen.getByText(/site/)).toBeInTheDocument()
    const html = document.body.innerHTML
    expect(html).not.toContain('exemple.org')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('evil.test')
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('b')).toBeNull()
  })

  it('pose des ancres sur les titres et affiche la table des matières à 3 sections', async () => {
    const a = artefact({
      blocs: [{ type: 'texte', markdown: '## Synthèse\nbla\n## Détail\nbla\n### Sous-partie\nbla' }],
    })
    render(<RenduDocument artefact={a} renduGraphique={renduGraphique} />)
    const nav = screen.getByRole('navigation', { name: 'Table des matières' })
    const liens = within(nav).getAllByRole('link')
    expect(liens.map(l => l.getAttribute('href'))).toEqual(['#synthese', '#detail', '#sous-partie'])
    const titre = screen.getByRole('heading', { name: 'Synthèse' })
    expect(titre).toHaveAttribute('id', 'synthese')
    expect(titre).toHaveAttribute('tabindex', '-1')

    await userEvent.click(liens[1])
    expect(screen.getByRole('heading', { name: 'Détail' })).toHaveFocus()
  })

  it('navigue entre les entrées de la table des matières aux flèches', async () => {
    const a = artefact({ blocs: [{ type: 'texte', markdown: '## A\nx\n## B\nx\n## C\nx' }] })
    render(<RenduDocument artefact={a} renduGraphique={renduGraphique} />)
    const nav = screen.getByRole('navigation', { name: 'Table des matières' })
    const liens = within(nav).getAllByRole('link')
    liens[0].focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(liens[1]).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(liens[2]).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(liens[0]).toHaveFocus()
  })

  it('n’affiche pas la table des matières pour un document court', () => {
    const a = artefact({ blocs: [{ type: 'texte', markdown: '## A\nx\n## B\nx' }] })
    render(<RenduDocument artefact={a} renduGraphique={renduGraphique} />)
    expect(screen.queryByRole('navigation', { name: 'Table des matières' })).toBeNull()
  })

  it('l’affiche pour un long texte même avec deux titres', () => {
    const a = artefact({
      blocs: [{ type: 'texte', markdown: `## A\n${'mot '.repeat(1200)}\n## B\nx` }],
    })
    render(<RenduDocument artefact={a} renduGraphique={renduGraphique} />)
    expect(screen.getByRole('navigation', { name: 'Table des matières' })).toBeInTheDocument()
  })

  it('garde des ids uniques si deux blocs répètent un titre', () => {
    const a = artefact({
      blocs: [
        { type: 'texte', markdown: '## Résumé\nx' },
        { type: 'texte', markdown: '## Résumé\nx\n## Autre\nx' },
      ],
    })
    render(<RenduDocument artefact={a} renduGraphique={renduGraphique} />)
    const ids = screen.getAllByRole('heading', { name: 'Résumé' }).map(h => h.id)
    expect(ids).toEqual(['resume', 'resume-2'])
  })

  it('remonte la modification d’un tableau de bloc dans la spécification du document', async () => {
    const onSpecChange = vi.fn()
    const a = artefact({
      modifiable: true,
      blocs: [
        { type: 'texte', markdown: 'avant' },
        { type: 'tableau', spec: { titre: 'Tableau', jeuDeDonneesId: 'j1' } },
      ],
    })
    render(
      <RenduDocument artefact={a} onSpecChange={onSpecChange} renduGraphique={renduGraphique} />
    )
    await userEvent.click(screen.getByRole('button', { name: /^CA/ }))
    const [spec] = onSpecChange.mock.calls[0] as [ArtefactDocument]
    expect(spec.type).toBe('document')
    expect(spec.blocs[0]).toEqual({ type: 'texte', markdown: 'avant' })
    expect(spec.blocs[1]).toMatchObject({
      type: 'tableau',
      spec: { tri: [{ cle: 'ca', sens: 'desc' }] },
    })
  })

  it('affiche un message pour un document vide', () => {
    render(<RenduDocument artefact={artefact({ blocs: [] })} renduGraphique={renduGraphique} />)
    expect(screen.getByText('Ce document est vide.')).toBeInTheDocument()
  })
})
