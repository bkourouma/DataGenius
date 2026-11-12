import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ApercuJointure, type ResultatApercu } from '@/app/(dashboard)/sources/combiner/apercu'

it('affiche le diagnostic complet à côté des lignes et conserve les chiffres exacts', () => {
  const colonne = { nom: 'montant', description: 'Montant', type: 'decimal' } as const
  const resultat: ResultatApercu = {
    colonnes: [colonne],
    lignes: [{ cellules: ['15.00'], correspondance: false }],
    tronque: true,
    diagnostic: {
      resultat: '9007199254740994',
      gauche: { lignes: '8', correspondances: '3', sansCorrespondance: '5', lignesCleNulle: '2', clesDupliquees: '0', lignesMultipliees: '1' },
      droite: { lignes: '6', correspondances: '6', sansCorrespondance: '0', lignesCleNulle: '0', clesDupliquees: '1', lignesMultipliees: '0' },
      totaux: [{ cote: 'gauche', colonne, avant: '9007199254740993.0025', apres: '9007199254740994.0025' }],
    },
  }

  render(<ApercuJointure resultat={resultat} afficherCorrespondances />)

  expect(screen.getByRole('heading', { name: 'Diagnostic de la jointure' })).toBeInTheDocument()
  expect(screen.getByText('9\u202f007\u202f199\u202f254\u202f740\u202f994', { normalizer: value => value })).toBeInTheDocument()
  expect(screen.getByText(/apparaissent plusieurs fois/)).toBeInTheDocument()
  const taux = screen.getByRole('row', { name: /Taux de correspondance/ })
  expect(within(taux).getByRole('cell', { name: '37,5 %' })).toBeInTheDocument()
  expect(within(taux).getByRole('cell', { name: '100,0 %' })).toBeInTheDocument()
  const sommes = within(screen.getByRole('region', { name: 'Comparaison des sommes' }))
  expect(sommes.getByText('9\u202f007\u202f199\u202f254\u202f740\u202f993,0025', { normalizer: value => value })).toBeInTheDocument()
  expect(sommes.getByText('9\u202f007\u202f199\u202f254\u202f740\u202f994,0025', { normalizer: value => value })).toBeInTheDocument()
  const apercu = within(screen.getByRole('region', { name: 'Tableau de prévisualisation' }))
  expect(apercu.getByRole('cell', { name: 'Sans correspondance' })).toBeInTheDocument()
  expect(apercu.getByRole('cell', { name: '15.00' })).toBeInTheDocument()
})
