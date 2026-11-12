import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RenduArtefact } from '@/components/medic-assist/artefacts/rendu-artefact'

import { artefactTest, jeuTest } from './_fixtures-artefacts-ui'
import { langueTest } from './_intl'

vi.mock('next-intl', async importOriginal =>
  (await import('./_intl')).mockNextIntl(await importOriginal())
)

afterEach(() => {
  langueTest.code = 'fr'
})

function limite(secondes: number) {
  return { ...jeuTest(), lignes: [], limiteDebit: { reessayerDansSecondes: secondes } }
}

describe('RenduArtefact : limite de recalculs atteinte', () => {
  it('tableau : message avec les minutes, pas de tableau vide, bouton Réessayer', async () => {
    const onReessayer = vi.fn()
    const artefact = artefactTest('tableau', { jeux: { 'jeu-1': limite(125) } })
    render(
      <RenduArtefact
        artefact={artefact}
        spec={artefact.spec}
        onSpecChange={vi.fn()}
        onReessayer={onReessayer}
      />
    )
    const alerte = screen.getByRole('alert')
    expect(alerte.textContent).toContain('limite de recalculs')
    expect(alerte.textContent).toContain('3 minutes')
    expect(screen.queryByRole('table')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(onReessayer).toHaveBeenCalledTimes(1)
  })

  it('une minute au minimum, au singulier, dans la langue active', () => {
    langueTest.code = 'en'
    const artefact = artefactTest('graphique', { jeux: { 'jeu-1': limite(5) } })
    render(<RenduArtefact artefact={artefact} spec={artefact.spec} onSpecChange={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('1 minute')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('indicateurs : le message remplace les cartes', () => {
    const artefact = artefactTest('indicateurs', { jeux: { 'jeu-1': limite(60) } })
    render(<RenduArtefact artefact={artefact} spec={artefact.spec} onSpecChange={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('1 minute')
  })

  it('sans limite, aucun message de limite', () => {
    const artefact = artefactTest('tableau')
    render(<RenduArtefact artefact={artefact} spec={artefact.spec} onSpecChange={vi.fn()} />)
    expect(screen.queryByText(/limite de recalculs/)).toBeNull()
  })
})
