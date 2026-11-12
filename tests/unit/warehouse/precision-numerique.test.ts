import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { estDecimalExact } from '@/lib/medic-assist/contrats/numerique'
import { normaliserValeur } from '@/lib/medic-assist/donnees/lecture-seule'
import { valeurBrute } from '@/lib/medic-assist/artefacts/exports/xlsx'

describe('Précision des valeurs analytiques', () => {
  it('conserve les décimales et les entiers trop précis dans le transport JSON et Excel', () => {
    const texte = '-9007199254740993.25'
    const valeur = normaliserValeur(new Prisma.Decimal(texte))
    expect(JSON.parse(JSON.stringify(valeur))).toBe(texte)
    expect(valeurBrute(valeur, 'decimal')).toBe(texte)
    expect(normaliserValeur(BigInt('9007199254740993'))).toBe('9007199254740993')
    expect(normaliserValeur(new Prisma.Decimal('0.000000000000000001'))).toBe('0.000000000000000001')
  })

  it('garde les nombres ordinaires et exige une chaîne décimale stricte', () => {
    expect(normaliserValeur(new Prisma.Decimal('180.25'))).toBe(180.25)
    expect(valeurBrute(180.25, 'decimal')).toBe(180.25)
    expect(estDecimalExact('-9007199254740993+1')).toBe(false)
  })
})
