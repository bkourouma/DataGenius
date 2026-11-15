import { describe, expect, it } from 'vitest'

import { construireCsv, echapperCelluleCsv } from '@/lib/audit/csv'

describe('echapperCelluleCsv', () => {
  it.each(['=1+1', '+33', '-5', '@SUM(A1)', '\tx', '\rx'])('neutralise une cellule commençant par %j', (valeur) => {
    const cellule = echapperCelluleCsv(valeur)
    const brut = cellule.startsWith('"') ? cellule.slice(1) : cellule
    expect(brut.startsWith("'")).toBe(true)
  })

  it('ne préfixe pas un texte ordinaire ni un nombre', () => {
    expect(echapperCelluleCsv('bonjour')).toBe('bonjour')
    expect(echapperCelluleCsv(-5)).toBe('-5')
    expect(echapperCelluleCsv(12)).toBe('12')
  })

  it('préfixe une chaîne "-5"', () => {
    expect(echapperCelluleCsv('-5')).toBe("'-5")
  })

  it('échappe virgules, guillemets et retours à la ligne', () => {
    expect(echapperCelluleCsv('a,b')).toBe('"a,b"')
    expect(echapperCelluleCsv('dit "oui"')).toBe('"dit ""oui"""')
    expect(echapperCelluleCsv('l1\nl2')).toBe('"l1\nl2"')
    expect(echapperCelluleCsv('a;b')).toBe('"a;b"')
  })

  it('gère null, undefined, Date et objet', () => {
    expect(echapperCelluleCsv(null)).toBe('')
    expect(echapperCelluleCsv(undefined)).toBe('')
    expect(echapperCelluleCsv(new Date('2025-03-01T10:00:00Z'))).toBe('2025-03-01T10:00:00.000Z')
    expect(echapperCelluleCsv({ a: 1 })).toBe('"{""a"":1}"')
  })

  it('cas combiné : formule avec guillemets et virgule', () => {
    expect(echapperCelluleCsv('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"')
  })
})

describe('construireCsv', () => {
  it('ajoute le BOM, sépare par virgule et termine les lignes par CRLF', () => {
    const csv = construireCsv(['a', 'b'], [['1', 'x,y'], [null, '=2']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1)).toBe("a,b\r\n1,\"x,y\"\r\n,'=2\r\n")
  })

  it('échappe aussi les en-têtes', () => {
    expect(construireCsv(['=bad'], []).slice(1)).toBe("'=bad\r\n")
  })
})
