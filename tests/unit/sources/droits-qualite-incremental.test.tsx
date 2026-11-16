import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormulaireQualite, RelancerImport } from '@/app/(dashboard)/sources/qualite/[cle]/formulaire'
import { FormulaireIncremental } from '@/app/(dashboard)/sources/incremental/[cle]/formulaire'
import { FormulaireEspace } from '@/app/(dashboard)/sources/droits/espaces/formulaire'
import { NouveauGroupe, TableauGroupes, TableauJeux } from '@/app/(dashboard)/sources/droits/formulaires'

// Les actions serveur importent lib/prisma : inutiles pour un rendu.
vi.mock('@/app/(dashboard)/sources/qualite/[cle]/actions', () => ({ enregistrer: vi.fn(), relancer: vi.fn() }))
vi.mock('@/app/(dashboard)/sources/incremental/[cle]/actions', () => ({ enregistrer: vi.fn(), relancer: vi.fn() }))
vi.mock('@/app/(dashboard)/sources/droits/espaces/actions', () => ({ sauvegarderEspace: vi.fn() }))
vi.mock('@/app/(dashboard)/sources/droits/actions', () => ({ ajouterGroupe: vi.fn(), enregistrerGroupe: vi.fn(), enregistrerRegle: vi.fn() }))
vi.mock('react-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  useFormStatus: () => ({ pending: false }),
  useFormState: (_action: unknown, etat: unknown) => [etat, () => {}],
}))

const colonnes = [
  { nom: 'nom', description: 'Nom', type: 'texte' },
  { nom: 'montant', description: 'Montant', type: 'montant' },
  { nom: 'jour', description: 'Jour', type: 'date' },
] as never

describe('FormulaireQualite (fr)', () => {
  const definition = {
    normalisations: [{ colonne: 'nom', operation: 'espaces' }],
    filtres: [{ colonne: 'nom', operateur: 'non_nul' }],
    controles: [{ type: 'plage', colonnes: ['montant'], min: '1' }],
  }
  const jeu = { cle: 'ventes', version: 1, colonnes, definition } as never

  it('reproduit les libellés français d’origine', () => {
    render(<FormulaireQualite jeu={jeu} />)
    expect(screen.getByText('Normaliser les valeurs')).toBeInTheDocument()
    expect(screen.getByLabelText('Colonne à normaliser 1')).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'Retirer les espaces aux extrémités' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('option', { name: 'Montant (montant)' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('option', { name: 'Jour (date)' }).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Comparaison du filtre 1')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Est renseigné' })).toBeInTheDocument()
    expect(screen.getByLabelText('Type du contrôle 1')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Minimum')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Maximum')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ajouter une normalisation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retirer le contrôle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enregistrer les règles' })).toBeInTheDocument()
  })

  it('affiche le bouton de relance', () => {
    render(<RelancerImport cle="ventes" />)
    expect(screen.getByRole('button', { name: 'Relancer la synchronisation' })).toBeInTheDocument()
  })
})

describe('FormulaireIncremental (fr)', () => {
  it('mode non activé puis activé', () => {
    const { unmount } = render(<FormulaireIncremental jeu={{ cle: 'ventes', colonnes, etat: null } as never} />)
    expect(screen.getByText('Clé stable')).toBeInTheDocument()
    expect(screen.getByText('Chevauchement des lectures (minutes)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activer le mode incrémental' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Désactiver' })).toBeNull()
    unmount()
    const etat = { version: 2, definition: { cles: ['nom'], dateModification: 'jour', chevauchementMinutes: 5, reconciliationMinutes: 1440 } }
    render(<FormulaireIncremental jeu={{ cle: 'ventes', colonnes, etat } as never} />)
    expect(screen.getByRole('button', { name: 'Enregistrer la configuration' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Désactiver' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Synchroniser maintenant' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réconcilier toutes les lignes' })).toBeInTheDocument()
  })
})

describe('Droits et espaces (fr)', () => {
  const jeux = [{ cle: 'ventes', titre: 'Ventes', colonnes: [{ nom: 'nom', description: 'Nom' }] }]
  const groupes = [{ id: 'g1', nom: 'Finance' }]

  it('tableau des groupes', () => {
    render(<TableauGroupes groupes={[{ id: 'g1', nom: 'Finance', membres: ['a', 'b'] }]} membres={[]} />)
    expect(screen.getByText('2 membre(s)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Modifier le groupe Finance' })).toBeInTheDocument()
    expect(screen.getByText('Actions')).toHaveClass('sr-only')
  })

  it('tableau des jeux : ouvert, restreint, administrateurs seuls', () => {
    const regles = new Map([['ventes', { groupes: ['g1'], masquer: [], filtre: null }], ['stock', { groupes: [], masquer: [], filtre: null }]])
    render(<TableauJeux jeux={[...jeux, { cle: 'stock', titre: 'Stock', colonnes: [] }, { cle: 'RH', titre: 'RH', colonnes: [] }]} groupes={groupes} regles={regles as never} />)
    expect(screen.getAllByText('Restreint')).toHaveLength(2)
    expect(screen.getByText('Ouvert')).toBeInTheDocument()
    expect(screen.getByText('Finance')).toBeInTheDocument()
    expect(screen.getByText('Administrateurs uniquement')).toBeInTheDocument()
    expect(screen.getByText('Tous les membres')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Modifier les droits de Ventes' })).toBeInTheDocument()
  })

  it('bouton nouveau groupe', () => {
    render(<NouveauGroupe />)
    expect(screen.getByRole('button', { name: 'Nouveau groupe' })).toBeInTheDocument()
  })

  it('formulaire d’espace : création et jeu occupé', () => {
    render(<FormulaireEspace groupes={groupes} jeux={[{ cle: 'ventes', titre: 'Ventes', occupe: true }]} />)
    expect(screen.getByLabelText('Nom de l’espace')).toBeInTheDocument()
    expect(screen.getByText('Ventes · Autre espace')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Créer l’espace' })).toBeInTheDocument()
  })
})
