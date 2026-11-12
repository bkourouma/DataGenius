import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BarreOutilsArtefact } from '@/components/medic-assist/artefacts/barre-outils-artefact'
import { RenduDocument } from '@/components/medic-assist/artefacts/rendu-document'
import { SelecteurForme } from '@/components/medic-assist/artefacts/selecteur-forme'
import { SelecteurVersion } from '@/components/medic-assist/artefacts/selecteur-version'

import type { ArtefactClient, JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

vi.mock('next-intl', async importOriginal =>
  (await import('./_intl')).mockNextIntl(await importOriginal())
)
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('sélecteur de version (point 4)', () => {
  it('affiche la date courte et peut occuper toute la largeur disponible', () => {
    render(
      <SelecteurVersion
        versions={[
          { version: 1, creeLe: '2026-11-01T10:00:00Z' },
          { version: 3, creeLe: '2026-11-02T17:39:00Z' },
        ]}
        versionAffichee={3}
        onChoisir={() => {}}
      />
    )
    const select = screen.getByRole('combobox')
    expect(select.className).toContain('max-w-full')
    expect(select.className).not.toContain('max-w-[14rem]')
    const options = within(select).getAllByRole('option')
    expect(options[0].textContent).toMatch(/^v3 · /)
    expect(options[0].textContent).not.toMatch(/novembre|nov\./i)
    expect(options[0].textContent).toContain('actuelle')
  })
})

describe('sélecteur de forme (point 5)', () => {
  it('passe à la ligne au lieu de défiler et rogner', () => {
    const jeu: JeuClient = {
      jeuDeDonneesId: 'j1',
      colonnes: [
        { cle: 'pays', libelle: 'Pays', type: 'texte' },
        { cle: 'ca', libelle: 'CA', type: 'montant' },
      ],
      lignes: [{ pays: 'A', ca: 1 }],
      nbLignes: 1,
      tronque: false,
      provenance: {} as never,
    }
    render(
      <SelecteurForme
        spec={{ forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] }}
        jeu={jeu}
        onChange={() => {}}
      />
    )
    const barre = screen.getByRole('toolbar')
    expect(barre.className).toContain('flex-wrap')
    expect(barre.className).not.toContain('overflow-x-auto')
  })
})

describe('barre d’actions compacte (point 7)', () => {
  it('garde les noms accessibles et replie les actions secondaires en icônes', async () => {
    const artefact = {
      id: 'a1',
      type: 'tableau',
      titre: 'T',
      versions: [{ version: 1, creeLe: '2026-11-02T00:00:00Z' }],
    } as unknown as ArtefactClient
    const surPartage = vi.fn()
    render(
      <BarreOutilsArtefact
        artefact={artefact}
        versionAffichee={1}
        onChoisirVersion={() => {}}
        vue="natif"
        onVue={() => {}}
        copiable
        onCopier={() => {}}
        provenanceOuverte={false}
        idProvenance="prov"
        onProvenance={() => {}}
        enregistrement="repos"
        actions={
          <div role="group" aria-label="Actions" className="flex flex-wrap">
            {['Enregistrer dans Mes analyses', 'Épingler au tableau de bord', 'Partager', 'Programmer'].map(n => (
              <button key={n} type="button" aria-label={n} onClick={n === 'Partager' ? surPartage : undefined}>
                <span className="hidden sm:inline">{n}</span>
              </button>
            ))}
          </div>
        }
      />
    )
    for (const nom of [
      'Enregistrer dans Mes analyses',
      'Épingler au tableau de bord',
      'Partager',
      'Programmer',
      'Télécharger',
      /Comment j.ai calculé/,
    ]) {
      expect(screen.getByRole('button', { name: nom })).toBeInTheDocument()
    }
    const zone = screen.getByTestId('actions-secondaires')
    expect(zone.className).toContain('[&_button>span]:!hidden')
    expect(zone.className).toContain('[&_[role=group]]:flex-nowrap')
    await userEvent.click(screen.getByRole('button', { name: 'Partager' }))
    expect(surPartage).toHaveBeenCalledTimes(1)
  })
})

describe('table des matières selon la largeur du conteneur (point 6)', () => {
  const artefactDoc = (): ArtefactClient =>
    ({
      id: 'doc1',
      racineId: 'doc1',
      version: 1,
      versions: [{ version: 1, creeLe: '2026-11-02T00:00:00Z' }],
      type: 'document',
      titre: 'Rapport',
      spec: {
        type: 'document',
        titre: 'Rapport',
        blocs: [{ type: 'texte', markdown: '## A\nx\n## B\nx\n## C\nx' }],
      },
      jeux: {},
      conversationId: null,
      creeLe: '2026-11-02T00:00:00Z',
      modifiable: false,
    }) as unknown as ArtefactClient

  function largeur(px: number) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: px,
      height: 100,
      top: 0,
      left: 0,
      right: px,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
  }

  it('étroit (480 px) : repliée au-dessus du contenu avec son bouton', () => {
    largeur(480)
    render(<RenduDocument artefact={artefactDoc()} renduGraphique={() => null} />)
    expect(screen.getByRole('article')).toHaveAttribute('data-tdm', 'repliee')
    const bouton = screen.getByRole('button', { name: /table des matières/i })
    expect(bouton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('article').className).not.toContain('grid')
  })

  it('large (>= 640 px) : colonne latérale, sans bouton de repli', () => {
    largeur(900)
    render(<RenduDocument artefact={artefactDoc()} renduGraphique={() => null} />)
    expect(screen.getByRole('article')).toHaveAttribute('data-tdm', 'laterale')
    expect(screen.getByRole('article').className).toContain('grid-cols-[minmax(0,1fr)_15rem]')
    expect(screen.queryByRole('button', { name: /table des matières/i })).toBeNull()
  })
})
