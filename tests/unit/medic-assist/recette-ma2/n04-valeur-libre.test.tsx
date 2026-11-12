import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { EditeurPivot, valeurLibre } from '@/components/medic-assist/artefacts/editeur-pivot'

import { langueTest } from '../lot4/_intl'

import type { ColonneJeu, ContenuTableau, Pivot } from '@/lib/medic-assist/contrats'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

vi.mock('next-intl', async importOriginal =>
  (await import('../lot4/_intl')).mockNextIntl(await importOriginal())
)

const colonnes: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'ca', libelle: 'CA', type: 'montant' },
  { cle: 'qte', libelle: 'Quantité', type: 'entier' },
  { cle: 'prix', libelle: 'Prix', type: 'decimal' },
  { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
]
const numeriques = colonnes.filter(c => c.type !== 'texte')

describe('N-04 : agrégat par défaut des valeurs ajoutées', () => {
  it('2e valeur additive : un autre champ en somme, pas le même champ en moyenne', () => {
    expect(valeurLibre(numeriques, [{ cle: 'ca', agregat: 'somme' }])).toEqual({
      cle: 'qte',
      agregat: 'somme',
    })
  })

  it('montant, entier et décimal sont sommés avant tout autre agrégat', () => {
    const prises = [
      { cle: 'ca', agregat: 'somme' as const },
      { cle: 'qte', agregat: 'somme' as const },
    ]
    expect(valeurLibre(numeriques, prises)).toEqual({ cle: 'prix', agregat: 'somme' })
  })

  it('un pourcentage reçoit la moyenne par défaut', () => {
    const prises = ['ca', 'qte', 'prix'].map(cle => ({ cle, agregat: 'somme' as const }))
    expect(valeurLibre(numeriques, prises)).toEqual({ cle: 'taux', agregat: 'moyenne' })
  })

  it('quand tous les champs sont pris par défaut, repli sur un autre agrégat', () => {
    const prises = numeriques.map(c => ({
      cle: c.cle,
      agregat: c.type === 'pourcentage' ? ('moyenne' as const) : ('somme' as const),
    }))
    expect(valeurLibre(numeriques, prises)).toEqual({ cle: 'ca', agregat: 'moyenne' })
  })

  it('« Ajouter une valeur » dans l’éditeur : Quantité (Somme)', async () => {
    langueTest.code = 'fr'
    const jeu: JeuClient = {
      jeuDeDonneesId: 'j1',
      colonnes,
      lignes: [],
      nbLignes: 0,
      tronque: false,
      provenance: {} as never,
    }
    const initial: Pivot = { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca', agregat: 'somme' }] }
    const onChange = vi.fn()
    function Controle() {
      const [spec, setSpec] = useState<ContenuTableau>({ titre: 'V', jeuDeDonneesId: 'j1', pivot: initial })
      return (
        <EditeurPivot
          spec={spec}
          jeu={jeu}
          modifiable
          onChange={p => {
            onChange(p)
            setSpec(s => ({ ...s, pivot: p }))
          }}
        />
      )
    }
    render(<Controle />)
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter une valeur' }))
    expect(onChange.mock.lastCall?.[0].valeurs).toEqual([
      { cle: 'ca', agregat: 'somme' },
      { cle: 'qte', agregat: 'somme' },
    ])
  })
})
