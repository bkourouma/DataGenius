import { describe, expect, it } from 'vitest'
import { decalerPeriode, dernierMoisComplet, libellePeriodeCourte, periodeDe } from '@/lib/donnees/periodes'

describe('Périodes mensuelles génériques', () => {
  it('décale une période en franchissant les années', () => {
    expect(decalerPeriode('2026-01', -1)).toBe('2025-12')
    expect(decalerPeriode('2026-11', 3)).toBe('2027-02')
    expect(decalerPeriode('2026-06', -23)).toBe('2024-07')
  })

  it('lit la période d’une date en heure locale', () => {
    expect(periodeDe(new Date(2026, 10, 1, 0, 0))).toBe('2026-11')
  })

  it('prend le mois précédent comme dernier mois complet, sans jour limite', () => {
    expect(dernierMoisComplet(new Date(2026, 10, 1))).toBe('2026-10')
    expect(dernierMoisComplet(new Date(2026, 10, 30))).toBe('2026-10')
    expect(dernierMoisComplet(new Date(2026, 0, 1))).toBe('2025-12')
  })

  it('libelle une fenêtre au mois près', () => {
    expect(libellePeriodeCourte('2026-09', '2026-09')).toBe('09/26')
    expect(libellePeriodeCourte('2026-04-01', '2026-09-01')).toBe('04/26 – 09/26')
  })
})
