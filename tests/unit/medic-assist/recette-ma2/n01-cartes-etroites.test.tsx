import { mkdirSync, writeFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RenduIndicateurs } from '@/components/medic-assist/artefacts/rendu-indicateurs'

import { langueTest } from '../lot4/_intl'

import type { CarteIndicateur, ColonneJeu } from '@/lib/medic-assist/contrats'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

vi.mock('next-intl', async importOriginal =>
  (await import('../lot4/_intl')).mockNextIntl(await importOriginal())
)

const COLS: ColonneJeu[] = [
  { cle: 'periode', libelle: 'Période', type: 'texte' },
  { cle: 'ca', libelle: 'CA', type: 'montant' },
]
const JEUX: Record<string, JeuClient> = {
  v: {
    jeuDeDonneesId: 'v',
    colonnes: COLS,
    lignes: [{ periode: 'septembre 2026', ca: 949755.87 }],
    nbLignes: 1,
    tronque: false,
    provenance: {} as never,
  },
}
const cartes: CarteIndicateur[] = [
  { libelle: 'septembre 2026', source: { jeuDeDonneesId: 'v', colonne: 'ca', ligne: 0 } },
  { libelle: 'Chiffre d’affaires de septembre 2026', source: { jeuDeDonneesId: 'v', colonne: 'ca', ligne: 0 } },
]

afterEach(() => {
  cleanup()
  langueTest.code = 'fr'
})

describe('N-01 : cartes lisibles dans un panneau étroit', () => {
  it('grille auto-fit avec largeur minimale, sans colonnes fixes par point de rupture', () => {
    render(<RenduIndicateurs cartes={cartes} jeux={JEUX} />)
    const liste = screen.getByRole('list')
    expect(liste.className).toContain('grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]')
    expect(liste.className).not.toMatch(/(^|\s)(sm|lg|xl):grid-cols-/)
  })

  it('ni coupure au milieu des mots, ni troncature du chiffre', () => {
    const { container } = render(<RenduIndicateurs cartes={cartes} jeux={JEUX} />)
    const html = container.innerHTML
    expect(html).not.toMatch(/break-all|break-words|overflow-wrap:\s*anywhere|\btruncate\b|text-ellipsis/)
    const chiffre = container.querySelector('[data-figure]') as HTMLElement
    expect(chiffre).toHaveTextContent(/949.756.€/)
    expect(chiffre.className).toContain('min-w-0')
    expect(screen.getAllByText(/septembre 2026/)).toHaveLength(2)
  })

  it('écrit le HTML du rendu pour la capture Playwright (si demandé)', () => {
    const sortie = process.env.N01_HTML_SORTIE
    if (!sortie) return
    const { container } = render(<RenduIndicateurs cartes={cartes} jeux={JEUX} />)
    mkdirSync(sortie.replace(/[\/][^\/]+$/, ''), { recursive: true })
    writeFileSync(sortie, container.innerHTML, 'utf8')
  })
})
