import { describe, expect, it } from 'vitest'
import { normaliser } from '@/lib/glossaire/normaliser'

describe('normaliser', () => {
  it('retire la casse et les accents', () => {
    expect(normaliser('Chiffre d’Affaires ÉLEVÉ à Ça')).toBe('chiffre d’affaires eleve a ca')
    expect(normaliser('Ñandú Über')).toBe('nandu uber')
  })

  it('laisse un texte déjà normalisé inchangé et gère le vide', () => {
    expect(normaliser('ventes')).toBe('ventes')
    expect(normaliser('')).toBe('')
  })

  it('rend identiques les formes composée et décomposée', () => {
    expect(normaliser('été')).toBe(normaliser('été'))
  })
})
