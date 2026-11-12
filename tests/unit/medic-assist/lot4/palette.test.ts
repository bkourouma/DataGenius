import { describe, expect, it } from 'vitest'

import {
  NB_COULEURS_SERIES,
  contraste,
  couleurEtatTaux,
  couleurSerie,
  couleursSeries,
  jetons,
  melanger,
} from '@/lib/medic-assist/artefacts/palette'

const ETATS = ['#1f6f3a', '#e19909', '#b82d1e']

function distance(a: string, b: string): number {
  const c = (h: string, k: number) => parseInt(h.slice(1 + 2 * k, 3 + 2 * k), 16)
  return Math.hypot(c(a, 0) - c(b, 0), c(a, 1) - c(b, 1), c(a, 2) - c(b, 2))
}

describe('palette des graphiques', () => {
  it.each(['clair', 'sombre'] as const)('10 couleurs de série contrastées sur le fond (%s)', theme => {
    const fond = jetons(theme).fond
    const couleurs = couleursSeries(NB_COULEURS_SERIES, theme)
    expect(couleurs).toHaveLength(10)
    for (const c of couleurs) expect(contraste(c, fond)).toBeGreaterThanOrEqual(3)
  })

  it('les couleurs de série sont toutes distinctes et distinguables entre elles', () => {
    for (const theme of ['clair', 'sombre'] as const) {
      const couleurs = couleursSeries(10, theme)
      expect(new Set(couleurs).size).toBe(10)
      for (let i = 0; i < couleurs.length; i++)
        for (let j = i + 1; j < couleurs.length; j++)
          expect(distance(couleurs[i], couleurs[j])).toBeGreaterThan(20)
    }
  })

  it('aucune série ne reprend une couleur d\'état', () => {
    const series = couleursSeries(10, 'clair')
    for (const e of ETATS) {
      expect(series).not.toContain(e)
      for (const s of series) expect(distance(s, e)).toBeGreaterThan(45)
    }
  })

  it('couleurSerie est cyclique et déterministe', () => {
    expect(couleurSerie(0, 'clair')).toBe('#0f4ca9')
    expect(couleurSerie(10, 'clair')).toBe(couleurSerie(0, 'clair'))
    expect(couleurSerie(-1, 'clair')).toBe(couleurSerie(9, 'clair'))
    expect(couleursSeries(0, 'clair')).toEqual([])
    expect(couleursSeries(3, 'sombre')).toEqual(couleursSeries(3, 'sombre'))
  })

  it('jetons clairs issus de DESIGN.md', () => {
    const j = jetons('clair')
    expect(j.cobalt).toBe('#0f4ca9')
    expect(j.encre).toBe('#111b2c')
    expect(j.encreAttenue).toBe('#4d596a')
    expect(j.quadrillage).toBe('#d4dbe2')
    expect(j.etat).toEqual({ atteint: '#1f6f3a', enCours: '#e19909', aRisque: '#b82d1e' })
    expect(contraste(j.encre, j.fond)).toBeGreaterThan(7)
    expect(contraste(j.encreAttenue, j.fond)).toBeGreaterThanOrEqual(4.5)
  })

  it('texte sur couleur de série lisible dans les deux thèmes', () => {
    for (const theme of ['clair', 'sombre'] as const) {
      const j = jetons(theme)
      for (const c of couleursSeries(10, theme)) expect(contraste(c, j.surSerie)).toBeGreaterThanOrEqual(3)
    }
  })

  it('couleurs d\'état selon les seuils 70 / 90', () => {
    const j = jetons('clair')
    expect(couleurEtatTaux(69.9, 'clair')).toBe(j.etat.aRisque)
    expect(couleurEtatTaux(70, 'clair')).toBe(j.etat.enCours)
    expect(couleurEtatTaux(89.9, 'clair')).toBe(j.etat.enCours)
    expect(couleurEtatTaux(90, 'clair')).toBe(j.etat.atteint)
  })

  it('melanger interpole', () => {
    expect(melanger('#000000', '#ffffff', 0)).toBe('#000000')
    expect(melanger('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(melanger('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('contraste noir / blanc = 21', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })
})
