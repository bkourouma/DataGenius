import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormulaireCatalogue } from '@/app/(dashboard)/sources/catalogue/[cle]/formulaire'
import { FormulaireCombinaison } from '@/app/(dashboard)/sources/combiner/formulaire'

// React 18 stable n'expose pas useFormStatus / useFormState dans jsdom.
vi.mock('react-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  useFormStatus: () => ({ pending: false }),
  useFormState: (_action: unknown, etat: unknown) => [etat, () => {}],
}))
vi.mock('@/app/(dashboard)/sources/catalogue/[cle]/actions', () => ({ publier: vi.fn() }))
vi.mock('@/app/(dashboard)/sources/combiner/actions', () => ({ enregistrerCombinaison: vi.fn(), previsualiserJointure: vi.fn() }))

describe('Formulaire du catalogue métier (fr)', () => {
  it('conserve les libellés français, agrégats, opérateurs et types de colonne', () => {
    const catalogue = {
      jeu: 'factures', version: 1,
      colonnes: [
        { nom: 'montant', type: 'decimal', description: 'Montant' },
        { nom: 'emise_le', type: 'date', description: 'Émise le' },
      ],
      definition: {
        description: 'Factures', grain: 'Une ligne par facture', cles: [], dimensions: [], colonnes: [],
        calendrierFiscal: { colonneDate: 'emise_le', moisDebutExercice: 11 },
        mesures: [{
          cle: 'total', libelle: 'Total', description: 'Somme', colonne: 'montant', agregat: 'rapport',
          denominateur: 'montant', filtres: [{ colonne: 'montant', operateur: 'different', valeur: '0' }],
        }],
      },
      historique: [],
    }
    render(<FormulaireCatalogue catalogue={catalogue as never} />)
    expect(screen.getByRole('heading', { name: 'Définition du jeu' })).toBeInTheDocument()
    expect(screen.getByLabelText('Début de l’exercice')).toHaveDisplayValue('novembre')
    expect(screen.getByLabelText('Clé métier · montant')).toBeInTheDocument()
    expect(screen.getByLabelText('Synonymes de montant')).toHaveAttribute('placeholder', 'Séparés par des virgules')
    expect(screen.getByText('(decimal)')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Rapport de deux sommes' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Différente de' })).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'Montant (decimal)' })[0]).toBeInTheDocument()
    expect(screen.getByText('Numérateur')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retirer l’indicateur' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publier la définition' })).toBeInTheDocument()
  })
})

describe('Formulaire de combinaison (fr)', () => {
  it('conserve les libellés français de la sélection', () => {
    const jeux = [
      { cle: 'a', titre: 'Ventes', sources: ['CRM'], colonnes: [{ nom: 'id', description: 'Identifiant', type: 'entier' }] },
      { cle: 'b', titre: 'Clients', sources: [], colonnes: [{ nom: 'id', description: 'Identifiant', type: 'entier' }] },
    ]
    render(<FormulaireCombinaison jeux={jeux as never} />)
    expect(screen.getByLabelText('Premier jeu')).toBeInTheDocument()
    expect(screen.getByLabelText('Deuxième jeu')).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'Choisir un jeu' })).toHaveLength(2)
    expect(screen.getAllByRole('option', { name: 'Ventes · CRM' })[0]).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'Clients' })[0]).toBeInTheDocument()
  })
})
