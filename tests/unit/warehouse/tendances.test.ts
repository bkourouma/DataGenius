import { describe, expect, it } from 'vitest'
import { analyserSerie, indiceMois, libelleMois } from '@/lib/warehouse/tendances-modele'

const janvier = indiceMois('2025-01')
const serie = (valeurs: (number | string | null)[]) => new Map(valeurs.map((valeur, i) => [libelleMois(janvier + i), valeur]))

describe('Analyse des séries mensuelles', () => {
  it('mesure l’erreur sans utiliser le mois à prédire', () => {
    const resultat = analyserSerie(serie([1, 2, 3, 4, 5, 6]), janvier, janvier + 5, 2)
    expect(resultat.validation).toEqual({ mae: 2, points: 3 })
    expect(resultat.previsions).toEqual([
      { mois: '2025-07', valeur: 5, bas: null, haut: null },
      { mois: '2025-08', valeur: 5, bas: null, haut: null },
    ])
  })

  it('repère un écart sur les mois précédents et donne une bande empirique si possible', () => {
    const valeurs = Array<number>(17).fill(10)
    valeurs[6] = 80
    const resultat = analyserSerie(serie(valeurs), janvier, janvier + 16, 1)
    expect(resultat.observations.filter(o => o.atypique).map(o => o.mois)).toEqual(['2025-07'])
    expect(resultat.validation).toEqual({ mae: 5, points: 14 })
    expect(resultat.previsions[0]).toEqual({ mois: '2026-06', valeur: 10, bas: 10, haut: 10 })
  })

  it('matérialise les mois absents et interrompt la série sans arrondir un entier trop grand', () => {
    const resultat = analyserSerie(serie([1, 2, 3, 4, 5, 6, null, '9007199254740993', 9]), janvier, janvier + 8, 1)
    expect(resultat.manquants).toBe(1)
    expect(resultat.valeursHorsPrecision).toBe(1)
    expect(resultat.observations[7].valeur).toBe('9007199254740993')
    expect(resultat.dernieresObservations).toBe(1)
    expect(resultat.previsions).toEqual([])
  })
})
