import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FormulaireTableau } from '@/app/(dashboard)/tableaux/formulaire'

vi.mock('@/app/(dashboard)/tableaux/actions', () => ({ enregistrer: vi.fn() }))
// Le React installé pour les tests n'expose pas les hooks de formulaire du canal Next.
vi.mock('react-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-dom')>(),
  useFormState: (_action: unknown, initial: unknown) => [initial, vi.fn()],
  useFormStatus: () => ({ pending: false }),
}))

const TUILE_ID = '3f1c2b4a-1111-4222-8333-444455556666'
const options = [{ cle: 'ventes', libelle: 'Ventes', mesures: [{ cle: 'total', libelle: 'Total' }], dimensions: [] }]
const comptes = [
  { id: 'l1', nom: 'Awa Traoré', email: 'awa@example.org' },
  { id: 'l2', nom: 'Moussa Diallo', email: 'moussa@example.org' },
  { id: 'l3', nom: 'Non partagé', email: 'np@example.org' },
]

type Alerte = Record<string, unknown>

function tableau(alerte: Alerte | undefined, lecteurs: string[]) {
  return {
    id: 'tab-1', version: 1, editable: true,
    definition: {
      titre: 'Mon tableau', lecteurs,
      tuiles: [{ id: TUILE_ID, type: 'mesure', jeu: 'ventes', mesure: 'total', dimensions: [], ...(alerte ? { alerte } : {}) }],
    },
  } as never
}

function monter(alerte: Alerte | undefined, lecteurs: string[], estAdmin = false) {
  return render(<FormulaireTableau tableau={tableau(alerte, lecteurs)} options={options as never} comptes={comptes} analyses={[]} estAdmin={estAdmin} />)
}

function configuration() {
  const champ = document.querySelector('input[name="configuration"]') as HTMLInputElement
  return JSON.parse(champ.value)
}

afterEach(cleanup)

describe('alerte du formulaire de tableau', () => {
  it('limite les destinataires aux lecteurs cochés et laisse le propriétaire fixe', () => {
    monter({ sens: 'au_dessus', seuil: '10' }, ['l1', 'l2'])
    const groupe = screen.getByRole('group', { name: 'Notifications de l’alerte' })
    expect(within(groupe).getByLabelText('Vous (propriétaire)')).toBeDisabled()
    expect(within(groupe).getByLabelText('Vous (propriétaire)')).toBeChecked()
    expect(within(groupe).getByLabelText('Awa Traoré')).toBeInTheDocument()
    expect(within(groupe).getByLabelText('Moussa Diallo')).toBeInTheDocument()
    expect(within(groupe).queryByLabelText('Non partagé')).toBeNull()
  })

  it('affiche le texte d’aide quand aucun lecteur n’est partagé', () => {
    monter({ sens: 'au_dessus', seuil: '10' }, [])
    expect(screen.getByText(/Partagez d’abord le tableau/)).toBeInTheDocument()
  })

  it('enregistre les destinataires cochés et les retire quand le lecteur est décoché dans Partager', () => {
    monter({ sens: 'au_dessus', seuil: '10' }, ['l1', 'l2'])
    const groupe = screen.getByRole('group', { name: 'Notifications de l’alerte' })
    fireEvent.click(within(groupe).getByLabelText('Awa Traoré'))
    fireEvent.click(within(groupe).getByLabelText('Moussa Diallo'))
    expect(configuration().tuiles[0].alerte.destinataires).toEqual(['l1', 'l2'])
    const partage = screen.getByRole('group', { name: 'Partager avec des lecteurs' })
    fireEvent.click(within(partage).getByLabelText('Awa Traoré'))
    expect(configuration().lecteurs).toEqual(['l2'])
    expect(configuration().tuiles[0].alerte.destinataires).toEqual(['l2'])
    fireEvent.click(within(partage).getByLabelText('Moussa Diallo'))
    expect(configuration().tuiles[0].alerte).toEqual({ sens: 'au_dessus', seuil: '10' })
  })

  it('masque le champ webhook pour un non-admin et conserve la valeur existante', () => {
    monter({ sens: 'au_dessus', seuil: '10', webhook: 'https://exemple.org/alerte' }, [])
    expect(screen.queryByLabelText(/Webhook HTTPS/)).toBeNull()
    expect(screen.getByText(/seul un administrateur peut le modifier/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Seuil'), { target: { value: '12' } })
    expect(configuration().tuiles[0].alerte).toEqual({ sens: 'au_dessus', seuil: '12', webhook: 'https://exemple.org/alerte' })
  })

  it('affiche et enregistre le champ webhook pour un admin', () => {
    monter({ sens: 'au_dessus', seuil: '10' }, [], true)
    const champ = screen.getByLabelText(/Webhook HTTPS/)
    expect(champ).toHaveAttribute('type', 'url')
    expect(champ).toHaveAttribute('maxlength', '2048')
    fireEvent.change(champ, { target: { value: 'https://exemple.org/a' } })
    expect(configuration().tuiles[0].alerte.webhook).toBe('https://exemple.org/a')
    fireEvent.change(champ, { target: { value: '' } })
    expect('webhook' in configuration().tuiles[0].alerte).toBe(false)
  })

  it('conserve les réglages au changement de sens et supprime tout en désactivant', () => {
    monter({ sens: 'au_dessus', seuil: '10', destinataires: ['l1'], email: true, webhook: 'https://exemple.org/a' }, ['l1'], true)
    const select = screen.getByLabelText('Alerte')
    fireEvent.change(select, { target: { value: 'au_dessous' } })
    expect(configuration().tuiles[0].alerte).toEqual({ sens: 'au_dessous', seuil: '10', destinataires: ['l1'], email: true, webhook: 'https://exemple.org/a' })
    fireEvent.change(select, { target: { value: '' } })
    expect(configuration().tuiles[0].alerte).toBeUndefined()
  })

  it('transforme les champs vides en undefined (pas de tableau vide ni de false)', () => {
    monter({ sens: 'au_dessus', seuil: '10', email: true, destinataires: ['l1'] }, ['l1'])
    fireEvent.click(screen.getByLabelText('Envoyer aussi un e-mail aux destinataires'))
    const groupe = screen.getByRole('group', { name: 'Notifications de l’alerte' })
    expect(configuration().tuiles[0].alerte).toEqual({ sens: 'au_dessus', seuil: '10', destinataires: ['l1'] })
    fireEvent.click(within(groupe).getByLabelText('Awa Traoré'))
    expect(configuration().tuiles[0].alerte).toEqual({ sens: 'au_dessus', seuil: '10' })
  })
})
