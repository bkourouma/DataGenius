import { afterEach, describe, expect, it, vi } from 'vitest'
import { assainir, journal, nouvelleReference } from '@/lib/journal'

afterEach(() => vi.restoreAllMocks())

describe('assainir', () => {
  it('masque les clés sensibles imbriquées et dans les tableaux', () => {
    const resultat = assainir({
      utilisateur: 'ana',
      Password: 'a',
      config: { clientSecret: 'b', liste: [{ accessToken: 'c', ok: 1 }] },
      en_tetes: { Authorization: 'Bearer x', Cookie: 'y' },
      cleApi: 'd',
      motdepasse: 'e',
    }) as Record<string, any>
    expect(resultat.utilisateur).toBe('ana')
    expect(resultat.Password).toBe('[masqué]')
    expect(resultat.config.clientSecret).toBe('[masqué]')
    expect(resultat.config.liste[0]).toEqual({ accessToken: '[masqué]', ok: 1 })
    expect(resultat.en_tetes).toEqual({ Authorization: '[masqué]', Cookie: '[masqué]' })
    expect(resultat.cleApi).toBe('[masqué]')
    expect(resultat.motdepasse).toBe('[masqué]')
  })

  it('transforme une Error en nom, message et code', () => {
    const erreur = Object.assign(new Error('boum'), { code: 'EFOO' })
    expect(assainir(erreur)).toEqual({ nom: 'Error', message: 'boum', code: 'EFOO' })
    expect(assainir(new TypeError('x'))).toEqual({ nom: 'TypeError', message: 'x' })
  })

  it('ne plante pas sur un cycle', () => {
    const a: Record<string, unknown> = { nom: 'a' }
    a.moi = a
    expect(assainir(a)).toEqual({ nom: 'a', moi: '[circulaire]' })
  })

  it('borne la profondeur', () => {
    let o: Record<string, unknown> = { fin: true }
    for (let i = 0; i < 30; i++) o = { suite: o }
    expect(() => JSON.stringify(assainir(o))).not.toThrow()
    expect(JSON.stringify(assainir(o))).toContain('[profondeur max]')
  })
})

describe('journal', () => {
  it('écrit une ligne JSON valide sur la bonne sortie', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const avert = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    journal.info('bonjour', { token: 'abc', n: 1 })
    journal.avertissement('attention')
    journal.erreur('raté', { erreur: new Error('x') })

    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0]).toHaveLength(1)
    const ligne = JSON.parse(info.mock.calls[0][0] as string)
    expect(ligne).toMatchObject({ niveau: 'info', message: 'bonjour', token: '[masqué]', n: 1 })
    expect(new Date(ligne.horodatage).toISOString()).toBe(ligne.horodatage)
    expect(JSON.parse(avert.mock.calls[0][0] as string).niveau).toBe('avertissement')
    expect(JSON.parse(err.mock.calls[0][0] as string).erreur.message).toBe('x')
  })

  it('enfant ajoute ses champs à chaque ligne', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const lie = journal.enfant({ reference: 'r1' }).enfant({ etape: 2 })
    lie.info('go', { plus: true })
    expect(JSON.parse(info.mock.calls[0][0] as string)).toMatchObject({
      reference: 'r1',
      etape: 2,
      plus: true,
    })
  })

  it('nouvelleReference : 8 caractères hexadécimaux', () => {
    expect(nouvelleReference()).toMatch(/^[0-9a-f]{8}$/)
    expect(nouvelleReference()).not.toBe(nouvelleReference())
  })
})
