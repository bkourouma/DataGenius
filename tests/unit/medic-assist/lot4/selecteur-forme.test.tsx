import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ICONES_FORMES, SelecteurForme } from '@/components/medic-assist/artefacts/selecteur-forme'
import { FORMES_GRAPHIQUE } from '@/lib/medic-assist/contrats'

import { langueTest } from './_intl'

import type { ColonneJeu, GraphiqueSpec } from '@/lib/medic-assist/contrats'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

vi.mock('next-intl', async importOriginal =>
  (await import('./_intl')).mockNextIntl(await importOriginal())
)

const COLS: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'periode', libelle: 'Période', type: 'periode' },
  { cle: 'canal', libelle: 'Canal', type: 'texte' },
  { cle: 'ca', libelle: "Chiffre d'affaires", type: 'montant' },
  { cle: 'qte', libelle: 'Quantité', type: 'entier' },
]

function jeu(colonnes: ColonneJeu[], nbPays = 4): JeuClient {
  const lignes = Array.from({ length: nbPays }, (_, i) => ({
    pays: `Pays ${i + 1}`,
    ca: 100 + i,
    qte: i + 1,
    periode: '2026-04',
    canal: 'A',
  }))
  return {
    jeuDeDonneesId: 'j1',
    colonnes,
    lignes,
    nbLignes: lignes.length,
    tronque: false,
    provenance: {} as never,
  }
}

const JEU = jeu(COLS)
const JEU_UNE_MESURE = jeu(COLS.filter(c => c.cle !== 'qte'))
const SPEC: GraphiqueSpec = { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] }

const NOMS: Record<string, string> = {
  barres: 'barres',
  barres_empilees: 'barres empilées',
  barres_horizontales: 'barres horizontales',
  lignes: 'lignes',
  aires: 'aires',
  secteurs: 'secteurs',
  anneau: 'anneau',
  nuage: 'nuage de points',
  combine: 'barres et lignes',
  carte_chaleur: 'carte de chaleur',
  treemap: 'treemap',
  entonnoir: 'entonnoir',
  jauge: 'jauge',
}

const bouton = (forme: string) =>
  screen.getByRole('button', { name: new RegExp(`^${NOMS[forme]}( \\(indisponible\\).*)?$`) })

afterEach(() => {
  cleanup()
  langueTest.code = 'fr'
})

describe('SelecteurForme', () => {
  it('propose les 13 formes, chacune avec son icône distincte et son nom traduit', () => {
    render(<SelecteurForme spec={SPEC} jeu={JEU} onChange={vi.fn()} />)
    expect(screen.getByRole('toolbar', { name: 'Forme du graphique' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(13)
    for (const forme of FORMES_GRAPHIQUE) {
      expect(bouton(forme).querySelector('svg')).toBeInTheDocument()
    }
    expect(new Set(FORMES_GRAPHIQUE.map(f => ICONES_FORMES[f])).size).toBe(13)
  })

  it('marque la forme courante avec aria-pressed', () => {
    render(<SelecteurForme spec={{ ...SPEC, forme: 'lignes', x: 'periode' }} jeu={JEU} onChange={vi.fn()} />)
    expect(bouton('lignes')).toHaveAttribute('aria-pressed', 'true')
    expect(bouton('barres')).toHaveAttribute('aria-pressed', 'false')
  })

  it('un clic change la forme et rend la spécification adaptée', async () => {
    const onChange = vi.fn()
    render(<SelecteurForme spec={SPEC} jeu={JEU} onChange={onChange} />)
    await userEvent.click(bouton('barres_empilees'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const [spec, info] = onChange.mock.calls[0]
    expect(spec).toMatchObject({ forme: 'barres_empilees', empile: true })
    expect(info).toEqual({ formeEffective: 'barres_empilees' })
  })

  it('un clic sur la forme courante ne fait rien', async () => {
    const onChange = vi.fn()
    render(<SelecteurForme spec={SPEC} jeu={JEU} onChange={onChange} />)
    await userEvent.click(bouton('barres'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('grise les formes indisponibles et explique le motif dans l\'info-bulle', async () => {
    const onChange = vi.fn()
    render(<SelecteurForme spec={SPEC} jeu={JEU_UNE_MESURE} onChange={onChange} />)
    const nuage = bouton('nuage')
    expect(nuage).toHaveAttribute('aria-disabled', 'true')
    expect(nuage).toHaveAttribute(
      'title',
      'nuage de points (indisponible) : Cette forme demande au moins deux mesures.'
    )
    expect(nuage).toHaveAccessibleName(/Cette forme demande au moins deux mesures/)
    expect(bouton('lignes')).not.toHaveAttribute('aria-disabled')

    // L'utilisateur est informé du refus (le parent affiche le toast).
    await userEvent.click(nuage)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][1]).toEqual({
      formeEffective: 'barres',
      motif: 'deux_mesures_requises',
    })
  })

  it('trop de catégories : secteurs est signalé et devient des barres horizontales', async () => {
    const onChange = vi.fn()
    render(<SelecteurForme spec={SPEC} jeu={jeu(COLS, 12)} onChange={onChange} />)
    expect(bouton('secteurs')).toHaveAttribute('aria-disabled', 'true')
    expect(bouton('secteurs')).toHaveAttribute('title', expect.stringContaining('Plus de 8 catégories'))
    await userEvent.click(bouton('secteurs'))
    expect(onChange.mock.calls[0][0]).toMatchObject({ forme: 'barres_horizontales' })
    expect(onChange.mock.calls[0][1]).toEqual({
      formeEffective: 'barres_horizontales',
      motif: 'trop_de_categories',
    })
  })

  it('désactive tout le sélecteur quand disabled', async () => {
    const onChange = vi.fn()
    render(<SelecteurForme spec={SPEC} jeu={JEU} onChange={onChange} disabled />)
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
    await userEvent.click(bouton('lignes'))
    expect(onChange).not.toHaveBeenCalled()
  })

  describe('clavier', () => {
    it('une seule tabulation (tabindex itinérant) sur la forme courante', async () => {
      render(<SelecteurForme spec={SPEC} jeu={JEU} onChange={vi.fn()} />)
      const tabbables = screen.getAllByRole('button').filter(b => b.getAttribute('tabindex') === '0')
      expect(tabbables).toEqual([bouton('barres')])
      await userEvent.tab()
      expect(bouton('barres')).toHaveFocus()
    })

    it('flèches, Début et Fin déplacent le focus avec retour à la ligne', async () => {
      render(<SelecteurForme spec={SPEC} jeu={JEU} onChange={vi.fn()} />)
      await userEvent.tab()
      await userEvent.keyboard('{ArrowRight}')
      expect(bouton('barres_empilees')).toHaveFocus()
      expect(bouton('barres_empilees')).toHaveAttribute('tabindex', '0')
      expect(bouton('barres')).toHaveAttribute('tabindex', '-1')
      await userEvent.keyboard('{End}')
      expect(bouton('jauge')).toHaveFocus()
      await userEvent.keyboard('{ArrowRight}')
      expect(bouton('barres')).toHaveFocus()
      await userEvent.keyboard('{ArrowLeft}')
      expect(bouton('jauge')).toHaveFocus()
      await userEvent.keyboard('{Home}')
      expect(bouton('barres')).toHaveFocus()
    })

    it('Entrée sur une forme focalisée la choisit', async () => {
      const onChange = vi.fn()
      render(<SelecteurForme spec={SPEC} jeu={JEU} onChange={onChange} />)
      await userEvent.tab()
      await userEvent.keyboard('{ArrowRight}{ArrowRight}{Enter}')
      expect(onChange.mock.calls[0][0]).toMatchObject({ forme: 'barres_horizontales' })
    })

    it('arabe : la flèche gauche avance (sens visuel inversé) et le dir est rtl', async () => {
      langueTest.code = 'ar'
      render(<SelecteurForme spec={SPEC} jeu={JEU} onChange={vi.fn()} />)
      expect(screen.getByRole('toolbar')).toHaveAttribute('dir', 'rtl')
      await userEvent.tab()
      await userEvent.keyboard('{ArrowLeft}')
      expect(screen.getAllByRole('button')[1]).toHaveFocus()
    })
  })

  it("passe à la ligne et n'utilise aucune classe left/right", () => {
    const { container } = render(<SelecteurForme spec={SPEC} jeu={JEU} onChange={vi.fn()} />)
    expect(screen.getByRole('toolbar').className).toContain('flex-wrap')
    expect(container.innerHTML).not.toMatch(/(?:^|[\s"'])-?(?:left|right|ml|mr|pl|pr)-/)
  })
})
