import { describe, expect, it } from 'vitest'
import { bornesExerciceCalendaire, libellePeriode } from '@/lib/medic-assist/donnees/moteur/temps'
import {
  MOIS_DEBUT_EXERCICE,
  bornesExercice,
  clauseExerciceBudget,
  exerciceCourant,
  libelleExercice,
  periodesExercice,
} from '@/lib/utils/exercice'

describe('Exercice par défaut : année civile', () => {
  it('commence en janvier quand aucun mois n’est réglé', () => {
    expect(MOIS_DEBUT_EXERCICE).toBe(1)
    const periodes = periodesExercice(2026)
    expect(periodes[0]).toBe('2026-01')
    expect(periodes[11]).toBe('2026-12')
    expect(bornesExerciceCalendaire(2026, MOIS_DEBUT_EXERCICE)).toEqual({ debut: '2026-01', fin: '2026-12' })
    expect(bornesExercice(2026).debut.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(bornesExercice(2026).fin.toISOString()).toBe('2026-12-31T23:59:59.999Z')
    expect(clauseExerciceBudget(2026)).toEqual({ annee: 2026 })
    expect(exerciceCourant(new Date(2026, 1, 15))).toBe(2026)
  })

  it('suit un mois de début réglé à avril : avril à mars', () => {
    expect(bornesExerciceCalendaire(2026, 4)).toEqual({ debut: '2026-04', fin: '2027-03' })
  })

  it('écrit un libellé naturel pour l’exercice civil et garde l’exercice décalé', () => {
    expect(libelleExercice(2026)).toBe('2026')
    expect(libelleExercice(2026, 4)).toBe('2026/2027')
    expect(libellePeriode('2026-01', '2026-06', 'fr')).toContain('exercice 2026')
    expect(libellePeriode('2026-01', '2026-06', 'fr')).not.toContain('2026/2027')
    expect(libellePeriode('2026-04', '2026-09', 'fr', 4)).toContain('exercice 2026/2027')
  })
})
