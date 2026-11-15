import { describe, expect, it } from 'vitest'
import { borner, LIMITES_DETAILS } from '@/lib/audit/details'

describe('borner', () => {
  it('renvoie un objet vide pour des détails absents', () => {
    expect(borner(undefined)).toEqual({})
  })

  it('conserve les primitives et tableaux de primitives', () => {
    expect(borner({ a: 'x', n: 3, b: true, v: null, t: [1, 'y', false, null] })).toEqual({
      a: 'x', n: 3, b: true, v: null, t: [1, 'y', false, null],
    })
  })

  it('ignore les nombres non finis, objets imbriqués, fonctions et bigint', () => {
    const resultat = borner({ inf: Infinity, nan: NaN, o: { a: 1 }, f: () => 1, g: BigInt(10), ok: 1 })
    expect(resultat).toEqual({ ok: 1 })
  })

  it('au plus 20 clés', () => {
    const details = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]))
    expect(Object.keys(borner(details))).toHaveLength(LIMITES_DETAILS.cles)
  })

  it('ignore les clés trop longues ou mal formées', () => {
    const resultat = borner({ ['a'.repeat(41)]: 1, 'a-b': 2, 'a b': 3, nombre_ok1: 4 })
    expect(resultat).toEqual({ nombre_ok1: 4 })
  })

  it('tronque les chaînes (200) et celles des tableaux (100) et limite les tableaux à 10', () => {
    const resultat = borner({ s: 'z'.repeat(500), t: Array.from({ length: 15 }, () => 'q'.repeat(300)) })
    expect((resultat.s as string).length).toBe(200)
    const t = resultat.t as string[]
    expect(t).toHaveLength(10)
    expect(t.every(e => e.length === 100)).toBe(true)
  })

  it.each(['password', 'Mot_de_passe_motdepasse', 'secret', 'api_token', 'cle_api', 'apiKey', 'Authorization', 'cookie', 'email', 'courriel_mail', 'contenu', 'donnees', 'lignes_brutes'])(
    'supprime la clé sensible %s',
    (cle) => {
      expect(borner({ [cle]: 'valeur', sain: 'ok' })).toEqual({ sain: 'ok' })
    },
  )

  it('masque une adresse e-mail dans une valeur, y compris dans un tableau', () => {
    expect(borner({ note: 'écrit à jean.dupont@example.test hier', l: ['a@b.co', 'ok'] })).toEqual({
      note: '[masqué]', l: ['[masqué]', 'ok'],
    })
  })

  it('JSON final <= 2000 caractères : les dernières clés sont retirées', () => {
    const details = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${String(i).padStart(2, '0')}`, 'x'.repeat(200)]))
    const resultat = borner(details)
    expect(JSON.stringify(resultat).length).toBeLessThanOrEqual(LIMITES_DETAILS.tailleJson)
    const cles = Object.keys(resultat)
    expect(cles.length).toBeGreaterThan(0)
    expect(cles.length).toBeLessThan(20)
    expect(cles[0]).toBe('k00')
  })

  it.each(['é', '漢'])('borne en octets UTF-8 : 20 chaînes multi-octets (%s) tiennent dans la limite', (c) => {
    const details = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, c.repeat(200)]))
    const octets = Buffer.byteLength(JSON.stringify(borner(details)), 'utf8')
    expect(octets).toBeLessThanOrEqual(LIMITES_DETAILS.tailleJson)
    expect(octets).toBeLessThanOrEqual(2000)
  })
})
