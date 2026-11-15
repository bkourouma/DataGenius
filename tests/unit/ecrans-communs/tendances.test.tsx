import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) },
}))
vi.mock('@/lib/medic-assist/acces', () => ({
  exigerMedicAssist: vi.fn(async () => ({ ok: true, contexte: { locale: 'fr' } })),
}))
vi.mock('@/lib/warehouse/tendances', () => {
  class ErreurTendances extends Error {}
  return {
    ErreurTendances,
    bornesTendances: () => ({ debut: '2025-01', fin: '2025-12' }),
    optionsTendances: async () => [{ cle: 'ventes', titre: 'Ventes', mesures: [{ cle: 'ca', libelle: 'Chiffre d’affaires' }] }],
    analyserTendance: async () => ({
      mesure: 'Chiffre d’affaires', unite: 'EUR', jeu: 'ventes',
      provenance: { libelleSource: 'Ventes', periode: { libelle: '2025' }, regles: ['Règle A'] },
      analyse: {
        manquants: 2, valeursHorsPrecision: 1, dernieresObservations: 4, validation: { points: 1, mae: 1234.5 },
        observations: [{ mois: '2025-01', valeur: 1234.5, atypique: true }],
        previsions: [],
      },
    }),
  }
})

import TendancesPage from '@/app/(dashboard)/tendances/page'

describe('page Tendances (français)', () => {
  it('affiche le formulaire et le résultat avec les textes français', async () => {
    render(await TendancesPage({ searchParams: { jeu: 'ventes', mesure: 'ca' } }))
    expect(screen.getByRole('heading', { name: 'Tendances mensuelles' })).toBeInTheDocument()
    expect(screen.getByText('Jeu de données')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyser la tendance' })).toBeInTheDocument()
    expect(screen.getByText('2 mois sans valeur.')).toBeInTheDocument()
    expect(screen.getByText('1 valeur affichée sans conversion et exclue des estimations.')).toBeInTheDocument()
    expect(screen.getByText('Atypique')).toBeInTheDocument()
    expect(screen.getByText(/Erreur absolue moyenne sur 1 prévision historique successive/)).toBeInTheDocument()
    expect(screen.getByText(/Série actuelle · 4 mois\./)).toBeInTheDocument()
    expect(screen.getByText('Règle A')).toBeInTheDocument()
  })
})
