import { describe, expect, it } from 'vitest'

import { analyserFiltres } from '@/lib/audit/filtres'

describe('analyserFiltres', () => {
  it('renvoie des filtres vides et la page 1 par défaut', () => {
    expect(analyserFiltres(new URLSearchParams())).toEqual({ filtres: {}, page: 1 })
  })

  it('lit des filtres valides (URLSearchParams et objet)', () => {
    const attendu = {
      filtres: {
        depuis: new Date('2025-01-01T00:00:00.000Z'),
        jusqua: new Date('2025-01-31T00:00:00.000Z'),
        acteur: 'marie',
        famille: 'source',
        action: 'source.creation',
        cible: 'abc',
      },
      page: 3,
    }
    const brut = { du: '2025-01-01', au: '2025-01-31', acteur: ' marie ', famille: 'source', action: 'source.creation', cible: 'abc', page: '3' }
    expect(analyserFiltres(brut)).toEqual(attendu)
    expect(analyserFiltres(new URLSearchParams(brut))).toEqual(attendu)
  })

  it('ignore les valeurs invalides sans lever', () => {
    const r = analyserFiltres({ du: '2025-13-40', au: 'hier', acteur: '   ', cible: 'x'.repeat(101), page: 'abc' })
    expect(r).toEqual({ filtres: {}, page: 1 })
    expect(analyserFiltres({ du: '2025-02-31' }).filtres.depuis).toBeUndefined()
  })

  it('ignore famille et action inconnues', () => {
    expect(analyserFiltres({ famille: 'inconnue', action: 'source.inconnue' }).filtres).toEqual({})
  })

  it('borne la page', () => {
    expect(analyserFiltres({ page: '0' }).page).toBe(1)
    expect(analyserFiltres({ page: '-4' }).page).toBe(1)
    expect(analyserFiltres({ page: '1.5' }).page).toBe(1)
    expect(analyserFiltres({ page: '999999999' }).page).toBe(100000)
  })

  it('inverse du et au si du > au', () => {
    const { filtres } = analyserFiltres({ du: '2025-05-10', au: '2025-05-01' })
    expect(filtres.depuis).toEqual(new Date('2025-05-01T00:00:00.000Z'))
    expect(filtres.jusqua).toEqual(new Date('2025-05-10T00:00:00.000Z'))
  })

  it('prend la première valeur d’un paramètre répété', () => {
    expect(analyserFiltres({ acteur: ['a', 'b'] }).filtres.acteur).toBe('a')
  })
})
