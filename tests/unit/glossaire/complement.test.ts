import { describe, expect, it } from 'vitest'
import { ComplementSchema, enregistrerComplementGlossaire } from '@/lib/glossaire/complement'
import { contexte, registreVentes } from './registre-test'

const valide = { jeu: 'ventes', indicateur: 'ca', definition: 'Texte', synonymes: ['a', 'b'] }

describe('ComplementSchema', () => {
  it('accepte la limite de 600 caractères et refuse au-delà', () => {
    expect(ComplementSchema.safeParse({ ...valide, definition: 'x'.repeat(600) }).success).toBe(true)
    expect(ComplementSchema.safeParse({ ...valide, definition: 'x'.repeat(601) }).success).toBe(false)
  })

  it('mesure la définition après suppression des espaces de bord', () => {
    const resultat = ComplementSchema.parse({ ...valide, definition: `  ${'x'.repeat(600)}  ` })
    expect(resultat.definition).toHaveLength(600)
  })

  it('refuse plus de 10 synonymes et des synonymes vides ou trop longs', () => {
    const onze = Array.from({ length: 11 }, (_, i) => `s${i}`)
    expect(ComplementSchema.safeParse({ ...valide, synonymes: onze }).success).toBe(false)
    expect(ComplementSchema.safeParse({ ...valide, synonymes: onze.slice(0, 10) }).success).toBe(true)
    expect(ComplementSchema.safeParse({ ...valide, synonymes: ['   '] }).success).toBe(false)
    expect(ComplementSchema.safeParse({ ...valide, synonymes: ['x'.repeat(61)] }).success).toBe(false)
    expect(ComplementSchema.safeParse({ ...valide, synonymes: ['x'.repeat(60)] }).success).toBe(true)
  })

  it('trime et dédoublonne les synonymes sans tenir compte de la casse', () => {
    const resultat = ComplementSchema.parse({ ...valide, synonymes: [' CA ', 'ca', 'Turnover', 'TURNOVER', 'Autre'] })
    expect(resultat.synonymes).toEqual(['CA', 'Turnover', 'Autre'])
  })

  it('refuse un champ inconnu', () => {
    expect(ComplementSchema.safeParse({ ...valide, modifiePar: 'x' }).success).toBe(false)
  })
})

describe('enregistrerComplementGlossaire', () => {
  it('refuse un membre avant toute lecture ou écriture', async () => {
    await expect(enregistrerComplementGlossaire(contexte('Member'), valide, { registre: registreVentes() }))
      .rejects.toMatchObject({ code: 'interdit' })
  })

  it('refuse une entrée invalide pour un administrateur', async () => {
    await expect(enregistrerComplementGlossaire(contexte('TenantAdmin'), { ...valide, definition: 'x'.repeat(601) }, { registre: registreVentes() }))
      .rejects.toMatchObject({ code: 'invalide' })
  })

  it('refuse un indicateur absent du registre autorisé', async () => {
    await expect(enregistrerComplementGlossaire(contexte('TenantAdmin'), { ...valide, indicateur: 'inconnu' }, { registre: registreVentes() }))
      .rejects.toMatchObject({ code: 'introuvable' })
    await expect(enregistrerComplementGlossaire(contexte('TenantAdmin'), { ...valide, jeu: 'autre' }, { registre: registreVentes() }))
      .rejects.toMatchObject({ code: 'introuvable' })
  })
})
