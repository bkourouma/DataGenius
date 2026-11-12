import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { EditeurPivot } from '@/components/medic-assist/artefacts/editeur-pivot'

import type {
  ColonneJeu,
  ContenuTableau,
  Pivot,
} from '@/lib/medic-assist/contrats'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

vi.mock('next-intl', async importOriginal =>
  (await import('./_intl')).mockNextIntl(await importOriginal())
)

const colonnes: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'periode', libelle: 'Période', type: 'periode' },
  { cle: 'produit', libelle: 'Produit', type: 'texte' },
  { cle: 'jour', libelle: 'Jour', type: 'date' },
  { cle: 'ca', libelle: 'CA', type: 'montant' },
  { cle: 'qte', libelle: 'Quantité', type: 'entier' },
  { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
]

const jeu: JeuClient = {
  jeuDeDonneesId: 'j1',
  colonnes,
  lignes: [],
  nbLignes: 0,
  tronque: false,
  provenance: {
    source: 'semantique',
    libelleSource: 'Ventes',
    perimetre: { pays: 'tous', libelle: 'Tous' },
    filtres: [],
    regles: [],
    calculeA: '2026-11-02T00:00:00Z',
  },
}

const base: ContenuTableau = { titre: 'Ventes', jeuDeDonneesId: 'j1' }
const pivotSimple: Pivot = {
  lignes: ['pays'],
  colonnes: [],
  valeurs: [{ cle: 'ca', agregat: 'somme' }],
}

/** Parent minimal : garde la spécification et transmet les changements. */
function Controle({
  initial,
  onChange,
  ouvert = true,
}: {
  initial?: Pivot
  onChange: (p: Pivot | undefined) => void
  ouvert?: boolean
}) {
  const [spec, setSpec] = useState<ContenuTableau>({ ...base, pivot: initial })
  return (
    <EditeurPivot
      spec={spec}
      jeu={jeu}
      modifiable
      ouvertParDefaut={ouvert}
      onChange={p => {
        setSpec(s => ({ ...s, pivot: p }))
        onChange(p)
      }}
    />
  )
}

const dernier = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0]

describe('EditeurPivot', () => {
  it('ne rend rien pour un lecteur', () => {
    const { container } = render(
      <EditeurPivot spec={base} jeu={jeu} modifiable={false} onChange={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('est replié par défaut sans tableau croisé et s’ouvre au clic', async () => {
    render(<EditeurPivot spec={base} jeu={jeu} modifiable onChange={vi.fn()} />)
    const bouton = screen.getByRole('button', { name: /Tableau croisé/ })
    expect(bouton).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(bouton)
    expect(bouton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Tableau', pressed: true })).toBeInTheDocument()
  })

  it('crée un tableau croisé de départ avec la bascule', async () => {
    const onChange = vi.fn()
    render(<Controle onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Tableau croisé', pressed: false }))
    expect(onChange).toHaveBeenCalledWith(pivotSimple)
    expect(screen.getByLabelText('Champ en lignes 1')).toHaveValue('pays')
    expect(screen.getByLabelText('Champ de la valeur 1')).toHaveValue('ca')
  })

  it('ne propose que des dimensions en lignes et des champs numériques en valeurs', () => {
    render(<Controle initial={pivotSimple} onChange={vi.fn()} />)
    const lignes = Array.from(screen.getByLabelText('Champ en lignes 1').querySelectorAll('option')).map(
      o => o.value
    )
    expect(lignes).toEqual(['pays', 'periode', 'produit', 'jour'])
    const valeurs = Array.from(screen.getByLabelText('Champ de la valeur 1').querySelectorAll('option')).map(
      o => o.value
    )
    expect(valeurs).toEqual(['ca', 'qte', 'taux'])
  })

  it('change un champ et un agrégat', async () => {
    const onChange = vi.fn()
    render(<Controle initial={pivotSimple} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Champ en lignes 1'), 'produit')
    expect(dernier(onChange)).toEqual({ ...pivotSimple, lignes: ['produit'] })
    await userEvent.selectOptions(screen.getByLabelText('Calcul de la valeur 1'), 'moyenne')
    expect(dernier(onChange).valeurs).toEqual([{ cle: 'ca', agregat: 'moyenne' }])
  })

  it('interdit un champ déjà utilisé en lignes ou en colonnes', async () => {
    const onChange = vi.fn()
    render(<Controle initial={pivotSimple} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ en colonnes' }))
    // « Pays » est déjà en lignes : le champ en colonnes reçoit une autre dimension
    expect(dernier(onChange).colonnes).toEqual(['periode'])
    const colonnesOptions = Array.from(
      screen.getByLabelText('Champ en colonnes 1').querySelectorAll('option')
    ).map(o => o.value)
    expect(colonnesOptions).not.toContain('pays')
    const lignesOptions = Array.from(
      screen.getByLabelText('Champ en lignes 1').querySelectorAll('option')
    ).map(o => o.value)
    expect(lignesOptions).not.toContain('periode')
  })

  it('respecte les limites : 3 lignes, 2 colonnes, 6 valeurs', async () => {
    const onChange = vi.fn()
    render(
      <Controle
        initial={{
          lignes: ['pays', 'periode', 'produit'],
          colonnes: ['jour'],
          valeurs: [{ cle: 'ca', agregat: 'somme' }],
        }}
        onChange={onChange}
      />
    )
    expect(screen.getByRole('button', { name: 'Ajouter un champ en lignes' })).toBeDisabled()
    expect(screen.getByText('Trois champs en lignes au plus.')).toBeInTheDocument()

    // six valeurs
    for (let i = 0; i < 5; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Ajouter une valeur' }))
    }
    expect(dernier(onChange).valeurs).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Ajouter une valeur' })).toBeDisabled()
    expect(screen.getByText('Six valeurs au plus.')).toBeInTheDocument()
    // jamais deux fois le même couple champ / agrégat
    const couples = (dernier(onChange).valeurs as { cle: string; agregat: string }[]).map(
      v => `${v.cle}|${v.agregat}`
    )
    expect(new Set(couples).size).toBe(6)
  })

  it('garde au moins une ligne et une valeur', () => {
    render(<Controle initial={pivotSimple} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Retirer le champ 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Retirer la valeur 1' })).toBeDisabled()
  })

  it('autorise zéro colonne : retirer la dernière colonne', async () => {
    const onChange = vi.fn()
    render(<Controle initial={{ ...pivotSimple, colonnes: ['periode'] }} onChange={onChange} />)
    const retraits = screen.getAllByRole('button', { name: /^Retirer le champ/ })
    await userEvent.click(retraits[retraits.length - 1])
    expect(dernier(onChange).colonnes).toEqual([])
  })

  it('avertit quand on additionne un pourcentage, puis cesse avec la moyenne', async () => {
    const onChange = vi.fn()
    render(
      <Controle initial={{ ...pivotSimple, valeurs: [{ cle: 'taux', agregat: 'somme' }] }} onChange={onChange} />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/Additionner des pourcentages/)
    await userEvent.selectOptions(screen.getByLabelText('Calcul de la valeur 1'), 'moyenne')
    expect(screen.queryByText(/Additionner des pourcentages/)).toBeNull()
  })

  it('retire le tableau croisé', async () => {
    const onChange = vi.fn()
    render(<Controle initial={pivotSimple} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Retirer le tableau croisé' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    expect(screen.queryByLabelText('Champ en lignes 1')).toBeNull()
  })

  it('bascule vers Tableau puis rappelle le tableau croisé précédent', async () => {
    const onChange = vi.fn()
    render(<Controle initial={{ ...pivotSimple, lignes: ['produit'] }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Tableau', pressed: false }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    await userEvent.click(screen.getByRole('button', { name: 'Tableau croisé', pressed: false }))
    expect(dernier(onChange).lignes).toEqual(['produit'])
  })

  it('est utilisable au clavier : Tab atteint chaque liste et chaque bouton', async () => {
    render(<Controle initial={pivotSimple} onChange={vi.fn()} />)
    const atteints = new Set<string>()
    for (let i = 0; i < 14; i++) {
      await userEvent.tab()
      const actif = document.activeElement as HTMLElement
      atteints.add(actif.getAttribute('aria-label') ?? actif.textContent ?? actif.tagName)
    }
    const liste = screen.getByLabelText('Champ en lignes 1')
    const valeur = screen.getByLabelText('Calcul de la valeur 1')
    liste.focus()
    expect(liste).toHaveFocus()
    valeur.focus()
    expect(valeur).toHaveFocus()
    expect(atteints.has('Ajouter une valeur')).toBe(true)
    expect(atteints.has('Retirer le tableau croisé')).toBe(true)
  })
})
