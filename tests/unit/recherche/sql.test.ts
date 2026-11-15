import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { requeteValide } from '@/lib/recherche/rechercher'
import { ACCENTS, SANS_ACCENT, contient } from '@/lib/recherche/sql'

describe('contient', () => {
  it('associe chaque lettre accentuée à une lettre sans accent', () => {
    expect([...ACCENTS]).toHaveLength([...SANS_ACCENT].length)
    expect(ACCENTS).toContain('é')
    expect(ACCENTS).toContain('É')
  })

  it('passe la requête normalisée en paramètre lié, jamais dans le texte SQL', () => {
    const condition = contient(Prisma.sql`t.titre`, "É'; DROP TABLE x; --")
    expect(condition.values).toContain("e'; drop table x; --")
    expect(condition.sql).not.toContain('DROP')
    expect(condition.sql).not.toMatch(/\bLIKE\b/i)
    expect(condition.sql).toContain('position(')
    expect(condition.sql).toContain('t.titre')
  })

  it('ne transforme pas les jokers : % et _ restent des caractères ordinaires', () => {
    expect(contient(Prisma.sql`t.titre`, '100%_').values).toContain('100%_')
  })
})

describe('requeteValide', () => {
  it('trime et accepte 2 à 100 caractères', () => {
    expect(requeteValide('  ab  ')).toBe('ab')
    expect(requeteValide('x'.repeat(100))).toHaveLength(100)
  })

  it('rejette trop court, trop long ou vide', () => {
    expect(requeteValide('a')).toBeNull()
    expect(requeteValide('   ')).toBeNull()
    expect(requeteValide('')).toBeNull()
    expect(requeteValide('x'.repeat(101))).toBeNull()
  })
})
