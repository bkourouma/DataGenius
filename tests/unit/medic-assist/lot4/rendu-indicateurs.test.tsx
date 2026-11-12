import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RenduIndicateurs } from '@/components/medic-assist/artefacts/rendu-indicateurs'

import { langueTest } from './_intl'

import type { CarteIndicateur, ColonneJeu } from '@/lib/medic-assist/contrats'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

vi.mock('next-intl', async importOriginal =>
  (await import('./_intl')).mockNextIntl(await importOriginal())
)

const COLS: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'ca', libelle: 'CA', type: 'montant' },
  { cle: 'budget', libelle: 'Budget', type: 'montant' },
]

function jeu(id: string, lignes: Record<string, unknown>[]): JeuClient {
  return {
    jeuDeDonneesId: id,
    colonnes: COLS,
    lignes,
    nbLignes: lignes.length,
    tronque: false,
    provenance: {} as never,
  }
}

const JEUX = {
  // Lignes : valeurs de réalisation autour de l'objectif 1000 (0 : 100 %, 1 : 99,9 %, 2 : 90 %, 3 : 89,9 %).
  ventes: jeu('ventes', [
    { pays: 'Mali', ca: 1000, budget: 1000 },
    { pays: 'Togo', ca: 999, budget: 1000 },
    { pays: 'Ghana', ca: 900, budget: 1000 },
    { pays: 'Niger', ca: 899, budget: 1000 },
    { pays: 'Benin', ca: 1200, budget: 1000 },
    { pays: 'Chad', ca: 800, budget: 1000 },
    { pays: 'Zéro', ca: 50, budget: 0 },
  ]),
} as Record<string, JeuClient>

const src = (ligne: number, colonne = 'ca') => ({ jeuDeDonneesId: 'ventes', colonne, ligne })

const carte = (partiel: Partial<CarteIndicateur> & Pick<CarteIndicateur, 'source'>): CarteIndicateur => ({
  libelle: 'Chiffre d\'affaires',
  ...partiel,
})

const carteObjectif = (ligne: number, libelle: string): CarteIndicateur =>
  carte({ libelle, source: src(ligne), objectif: { source: src(ligne, 'budget') } })

const nbsp = '[\\s\\u00a0\\u202f]'

afterEach(() => {
  cleanup()
  langueTest.code = 'fr'
})

describe('RenduIndicateurs', () => {
  it('affiche le libellé, la valeur formatée résolue depuis le jeu et la lampe neutre', () => {
    const { container } = render(
      <RenduIndicateurs cartes={[carte({ source: src(4) })]} jeux={JEUX} />
    )
    const liste = screen.getByRole('list', { name: 'Indicateurs' })
    const item = within(liste).getByRole('listitem')
    expect(within(item).getByText("Chiffre d'affaires")).toBeInTheDocument()
    const valeur = container.querySelector('[data-figure]') as HTMLElement
    expect(valeur.textContent).toMatch(new RegExp(`^1${nbsp}?200${nbsp}?€$`))
    expect(valeur.className).toContain('text-3xl')
    expect(valeur.className).toContain('tabular-nums')
    expect(container.querySelector('[aria-hidden="true"].bg-slate-400')).toBeInTheDocument()
  })

  it('valeur manquante : tiret visible et libellé accessible « donnée indisponible »', () => {
    const { container } = render(
      <RenduIndicateurs
        cartes={[carte({ source: { jeuDeDonneesId: 'inconnu', colonne: 'ca' } })]}
        jeux={JEUX}
      />
    )
    expect(screen.getByText('Donnée indisponible')).toHaveClass('sr-only')
    expect(container.querySelector('[data-figure] [aria-hidden="true"]')).toHaveTextContent('—')
  })

  describe('comparaison', () => {
    const avec = (ligneRef: number, ligne = 4) =>
      carte({
        source: src(ligne),
        comparaison: { source: src(ligneRef), libelle: 'vs mois précédent' },
      })

    it('hausse : variation signée, mot et référence', () => {
      const { container } = render(<RenduIndicateurs cartes={[avec(0)]} jeux={JEUX} />)
      // 1200 contre 1000 = +20 %
      expect(screen.getByText(new RegExp(`^\\+20,0${nbsp}%${nbsp}en hausse$`))).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`^vs mois précédent : 1${nbsp}?000${nbsp}?€$`))).toBeInTheDocument()
      expect(container.querySelector('svg.lucide-trending-up')).toBeInTheDocument()
    })

    it('baisse : mot et flèche descendante', () => {
      const { container } = render(<RenduIndicateurs cartes={[avec(0, 5)]} jeux={JEUX} />)
      expect(screen.getByText(new RegExp(`20,0${nbsp}%${nbsp}en baisse$`))).toBeInTheDocument()
      expect(container.querySelector('svg.lucide-trending-down')).toBeInTheDocument()
    })

    it('stable : même valeur, mot et tiret d\'icône', () => {
      const { container } = render(<RenduIndicateurs cartes={[avec(0, 0)]} jeux={JEUX} />)
      expect(screen.getByText(new RegExp(`^0,0${nbsp}%${nbsp}stable$`))).toBeInTheDocument()
      expect(container.querySelector('svg.lucide-minus')).toBeInTheDocument()
    })

    it('référence nulle : variation indisponible', () => {
      render(
        <RenduIndicateurs
          cartes={[
            carte({
              source: src(4),
              comparaison: { source: src(6, 'budget'), libelle: 'vs budget' },
            }),
          ]}
          jeux={JEUX}
        />
      )
      expect(screen.getByText('Variation indisponible')).toBeInTheDocument()
      expect(screen.getByText(/^vs budget : /)).toBeInTheDocument()
    })
  })

  describe('objectif et badge', () => {
    it.each([
      [0, 'Atteint', 'bg-green-600', 'bg-success-soft'],
      [4, 'Atteint', 'bg-green-600', 'bg-success-soft'], // au-dessus de l'objectif
      [1, 'En cours', 'bg-yellow-500', 'bg-warning-soft'], // 99,9 %
      [2, 'En cours', 'bg-yellow-500', 'bg-warning-soft'], // 90 % pile
      [3, 'À risque', 'bg-red-600', 'bg-danger-soft'], // 89,9 %
      [5, 'À risque', 'bg-red-600', 'bg-danger-soft'],
    ])('ligne %i : badge « %s », lampe et variante cohérentes', (ligne, texte, lampe, badge) => {
      const { container } = render(
        <RenduIndicateurs cartes={[carteObjectif(ligne, 'Objectif CA')]} jeux={JEUX} />
      )
      const marque = screen.getByText(texte)
      expect(marque.className).toContain(badge) // le texte est toujours présent
      expect(container.querySelector(`[aria-hidden="true"].${lampe}`)).toBeInTheDocument()
      expect(marque.querySelector('svg')).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`^Objectif : 1${nbsp}?000${nbsp}?€$`))).toBeInTheDocument()
    })

    it('affiche le taux de réalisation formaté', () => {
      render(<RenduIndicateurs cartes={[carteObjectif(2, 'CA')]} jeux={JEUX} />)
      expect(screen.getByText(new RegExp(`^Taux de réalisation : 90,0${nbsp}%$`))).toBeInTheDocument()
    })

    it('utilise le libellé d\'objectif quand il existe', () => {
      render(
        <RenduIndicateurs
          cartes={[
            carte({
              source: src(0),
              objectif: { source: src(0, 'budget'), libelle: 'Budget annuel' },
            }),
          ]}
          jeux={JEUX}
        />
      )
      expect(screen.getByText(/^Budget annuel : /)).toBeInTheDocument()
    })

    it('objectif nul : taux indisponible et aucun badge', () => {
      render(<RenduIndicateurs cartes={[carteObjectif(6, 'CA')]} jeux={JEUX} />)
      expect(screen.getByText('Taux de réalisation indisponible')).toBeInTheDocument()
      for (const texte of ['Atteint', 'En cours', 'À risque']) {
        expect(screen.queryByText(texte)).not.toBeInTheDocument()
      }
    })
  })

  it('grille : une colonne par défaut, puis 2, 3 et 4', () => {
    render(
      <RenduIndicateurs
        cartes={[carte({ source: src(0) }), carte({ source: src(1) })]}
        jeux={JEUX}
      />
    )
    const liste = screen.getByRole('list')
    // N-01 : grille auto-fit à largeur minimale (pas de colonnes fixes par point de rupture).
    expect(liste.className).toContain('grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]')
    expect(within(liste).getAllByRole('listitem')).toHaveLength(2)
  })

  it('aucune carte : message', () => {
    render(<RenduIndicateurs cartes={[]} jeux={JEUX} />)
    expect(screen.getByText('Aucun indicateur à afficher')).toBeInTheDocument()
  })

  it('anglais : format de nombre de la langue', () => {
    langueTest.code = 'en'
    const { container } = render(<RenduIndicateurs cartes={[carte({ source: src(4) })]} jeux={JEUX} />)
    expect(container.querySelector('[data-figure]')?.textContent).toBe('€1,200')
    expect(screen.getByRole('list')).toHaveAttribute('dir', 'ltr')
  })

  it('arabe : dir rtl et aucune classe left/right', () => {
    langueTest.code = 'ar'
    const { container } = render(
      <RenduIndicateurs
        cartes={[
          carteObjectif(1, 'CA'),
          carte({ source: src(4), comparaison: { source: src(0), libelle: 'ref' } }),
        ]}
        jeux={JEUX}
      />
    )
    expect(screen.getByRole('list')).toHaveAttribute('dir', 'rtl')
    expect(container.innerHTML).not.toMatch(/(?:^|[\s"'])-?(?:left|right|ml|mr|pl|pr)-/)
  })
})
