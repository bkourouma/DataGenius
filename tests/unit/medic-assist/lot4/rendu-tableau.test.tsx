import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { RenduTableau, type RenduTableauHandle } from '@/components/medic-assist/artefacts/rendu-tableau'

import type { ColonneJeu, ContenuTableau } from '@/lib/medic-assist/contrats'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

vi.mock('next-intl', async importOriginal =>
  (await import('./_intl')).mockNextIntl(await importOriginal())
)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const colonnes: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'periode', libelle: 'Période', type: 'periode' },
  { cle: 'ca', libelle: 'CA', type: 'montant' },
  { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
]

const lignes = [
  { pays: 'Mali', periode: '2026-04', ca: 300, taux: 80 },
  { pays: 'Ghana', periode: '2026-04', ca: 100, taux: 50 },
  { pays: 'Togo', periode: '2026-05', ca: 200, taux: 90 },
]

function jeu(partiel: Partial<JeuClient> = {}): JeuClient {
  return {
    jeuDeDonneesId: 'j1',
    colonnes,
    lignes,
    nbLignes: lignes.length,
    tronque: false,
    provenance: {
      source: 'semantique',
      libelleSource: 'Ventes',
      perimetre: { pays: 'tous', libelle: 'Tous les pays' },
      filtres: [],
      regles: [],
      calculeA: '2026-11-02T00:00:00Z',
    },
    ...partiel,
  }
}

const base: ContenuTableau = { titre: 'Ventes', jeuDeDonneesId: 'j1' }

/** Textes de la colonne `index` du corps, dans l'ordre affiché. */
function colonneAffichee(index: number): string[] {
  const corps = document.querySelector('tbody')!
  return Array.from(corps.querySelectorAll('tr')).map(
    tr => tr.querySelectorAll('td')[index]?.textContent ?? ''
  )
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  window.localStorage.clear()
})

describe('RenduTableau', () => {
  it('affiche en-têtes, valeurs formatées et nombre de lignes', () => {
    render(<RenduTableau spec={base} jeu={jeu()} />)
    expect(screen.getByRole('columnheader', { name: /Pays/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /CA/ })).toBeInTheDocument()
    expect(screen.getByText('Mali')).toBeInTheDocument()
    expect(screen.getByText(/^300\s€$/)).toBeInTheDocument()
    expect(screen.getByText(/^80,0\s%$/)).toBeInTheDocument()
    expect(screen.getByTestId('compteur-tableau')).toHaveTextContent('3 lignes')
    // les nombres sont alignés en fin de cellule, chiffres tabulaires
    const cellule = screen.getByText(/^300\s€$/).closest('td')!
    expect(cellule.className).toContain('text-end')
    expect(cellule.className).toContain('tabular-nums')
  })

  it('affiche un squelette tant que le jeu manque', () => {
    render(<RenduTableau spec={base} jeu={undefined} />)
    expect(screen.getByRole('status', { name: 'Chargement du tableau' })).toBeInTheDocument()
  })

  it('trie au clic sur un en-tête', async () => {
    render(<RenduTableau spec={base} jeu={jeu()} />)
    // ordre par défaut : dimension de A à Z
    expect(colonneAffichee(0)).toEqual(['Ghana', 'Mali', 'Togo'])
    // une colonne numérique se trie d'abord du plus grand au plus petit
    await userEvent.click(screen.getByRole('button', { name: /^CA/ }))
    expect(colonneAffichee(0)).toEqual(['Mali', 'Togo', 'Ghana'])
    await userEvent.click(screen.getByRole('button', { name: /^CA/ }))
    expect(colonneAffichee(0)).toEqual(['Ghana', 'Togo', 'Mali'])
  })

  it('remonte le tri dans la spécification si le tableau est modifiable', async () => {
    const onSpecChange = vi.fn()
    render(<RenduTableau spec={base} jeu={jeu()} modifiable onSpecChange={onSpecChange} />)
    expect(onSpecChange).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /^CA/ }))
    await waitFor(() => expect(onSpecChange).toHaveBeenCalledTimes(1))
    expect(onSpecChange).toHaveBeenLastCalledWith({
      ...base,
      tri: [{ cle: 'ca', sens: 'desc' }],
    })
    await userEvent.click(screen.getByRole('button', { name: /^CA/ }))
    await waitFor(() => expect(onSpecChange).toHaveBeenCalledTimes(2))
    expect(onSpecChange).toHaveBeenLastCalledWith({
      ...base,
      tri: [{ cle: 'ca', sens: 'asc' }],
    })
  })

  it('ne remonte rien sans modifiable, ni sans geste de l’utilisateur', async () => {
    const onSpecChange = vi.fn()
    render(<RenduTableau spec={base} jeu={jeu()} onSpecChange={onSpecChange} />)
    await userEvent.click(screen.getByRole('button', { name: /^CA/ }))
    expect(colonneAffichee(0)).toEqual(['Mali', 'Togo', 'Ghana'])
    expect(onSpecChange).not.toHaveBeenCalled()
  })

  it('applique le tri de la spécification', () => {
    render(<RenduTableau spec={{ ...base, tri: [{ cle: 'ca', sens: 'desc' }] }} jeu={jeu()} />)
    expect(colonneAffichee(0)).toEqual(['Mali', 'Togo', 'Ghana'])
  })

  it('affiche la ligne de totaux en pied de tableau', () => {
    render(<RenduTableau spec={{ ...base, totaux: true }} jeu={jeu()} />)
    const pied = document.querySelector('tfoot')!
    expect(pied).toBeInTheDocument()
    expect(within(pied as HTMLElement).getByText(/^Total/)).toBeInTheDocument()
    expect(within(pied as HTMLElement).getByText(/^600\s€$/)).toBeInTheDocument()
  })

  it('affiche un tableau croisé avec des en-têtes aplatis', () => {
    render(
      <RenduTableau
        spec={{
          ...base,
          pivot: { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca', agregat: 'somme' }] },
        }}
        jeu={jeu()}
      />
    )
    const entetes = screen.getAllByRole('columnheader').map(th => th.textContent ?? '')
    expect(entetes.some(e => e.includes(' · ') && e.includes('CA'))).toBe(true)
    expect(screen.getByRole('columnheader', { name: /Pays/ })).toBeInTheDocument()
    expect(screen.getByText('Mali')).toBeInTheDocument()
  })

  it('filtre avec la recherche', async () => {
    render(<RenduTableau spec={base} jeu={jeu()} />)
    await userEvent.type(screen.getByRole('textbox'), 'gha')
    // la recherche attend la fin de la frappe (250 ms)
    await waitFor(() => expect(colonneAffichee(0)).toEqual(['Ghana']))
    expect(screen.getByTestId('compteur-tableau')).toHaveTextContent('1 ligne')
  })

  it('propose de réinitialiser les filtres quand ils vident le tableau', async () => {
    const onSpecChange = vi.fn()
    const spec: ContenuTableau = {
      ...base,
      filtres: [{ cle: 'pays', operateur: 'egal', valeur: 'Nulle part' }],
    }
    render(<RenduTableau spec={spec} jeu={jeu()} modifiable onSpecChange={onSpecChange} />)
    expect(screen.getByText('Aucune ligne pour ces filtres')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser les filtres' }))
    expect(onSpecChange).toHaveBeenCalledWith({ ...spec, filtres: undefined })
    // la réinitialisation vaut aussi à l'écran, sans attendre le parent
    expect(screen.getByText('Mali')).toBeInTheDocument()
  })

  it('réinitialise les filtres localement pour un lecteur', async () => {
    const spec: ContenuTableau = {
      ...base,
      filtres: [{ cle: 'pays', operateur: 'egal', valeur: 'Nulle part' }],
    }
    render(<RenduTableau spec={spec} jeu={jeu()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser les filtres' }))
    expect(screen.getByText('Togo')).toBeInTheDocument()
  })

  it('annonce un jeu vide sans bouton de réinitialisation', () => {
    render(<RenduTableau spec={base} jeu={jeu({ lignes: [], nbLignes: 0 })} />)
    expect(screen.getByText('Aucune ligne à afficher')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Réinitialiser les filtres' })).toBeNull()
  })

  it('avertit quand le jeu est tronqué', () => {
    render(<RenduTableau spec={base} jeu={jeu({ tronque: true })} />)
    expect(screen.getByRole('status')).toHaveTextContent(/3 premières lignes/)
    expect(screen.getByRole('status')).toHaveTextContent(/export complet/)
  })

  it('n’affiche aucun avertissement si le jeu est complet', () => {
    render(<RenduTableau spec={base} jeu={jeu()} />)
    expect(screen.queryByText(/export complet/)).toBeNull()
  })
})

describe('RenduTableau : copie TSV', () => {
  it('copie le tableau affiché (tri compris) dans le presse-papiers', async () => {
    const ref = createRef<RenduTableauHandle>()
    const ecrire = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(ecrire)

    render(<RenduTableau ref={ref} spec={{ ...base, totaux: true }} jeu={jeu()} />)
    await userEvent.click(screen.getByRole('button', { name: /^CA/ }))

    const ok = await ref.current!.copierTsv()
    expect(ok).toBe(true)
    expect(ecrire).toHaveBeenCalledTimes(1)
    const texte = ecrire.mock.calls[0][0] as string
    const l = texte.split('\n')
    expect(l[0]).toBe('Pays\tPériode\tCA\tTaux')
    expect(l[1].split('\t')[0]).toBe('Mali')
    expect(l[3].split('\t')[0]).toBe('Ghana')
    expect(l[l.length - 1].split('\t')[0]).toMatch(/^Total/)
  })

  it('renvoie false quand le navigateur refuse la copie', async () => {
    const ref = createRef<RenduTableauHandle>()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('refus'))
    render(<RenduTableau ref={ref} spec={base} jeu={jeu()} />)
    expect(await ref.current!.copierTsv()).toBe(false)
  })

  it('expose le modèle affiché', async () => {
    const ref = createRef<RenduTableauHandle>()
    render(<RenduTableau ref={ref} spec={{ ...base, totaux: true }} jeu={jeu()} />)
    const modele = ref.current!.modele()
    expect(modele.colonnes.map(c => c.id)).toEqual(['pays', 'periode', 'ca', 'taux'])
    expect(modele.lignes).toHaveLength(3)
    expect(modele.totaux?.ca).toBe(600)
  })
})
