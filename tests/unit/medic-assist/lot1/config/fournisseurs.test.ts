import { describe, expect, it } from 'vitest'

import {
  FOURNISSEURS,
  MODELES_CLAUDE_PAR_DEFAUT,
  MODES_LANGAGE,
  VARIABLES_CLES_FOURNISSEURS,
} from '@/lib/medic-assist/contrats'
import {
  REGISTRE_FOURNISSEURS,
  estFournisseur,
  modelesParDefaut,
} from '@/lib/medic-assist/config/fournisseurs'

describe('registre des fournisseurs', () => {
  it('couvre les 4 fournisseurs avec la bonne variable de cle', () => {
    expect(Object.keys(REGISTRE_FOURNISSEURS).sort()).toEqual([...FOURNISSEURS].sort())
    for (const f of FOURNISSEURS) {
      expect(REGISTRE_FOURNISSEURS[f].variableCle).toBe(VARIABLES_CLES_FOURNISSEURS[f])
    }
  })

  it('donne un modele par defaut par mode, present dans les modeles proposes', () => {
    for (const f of FOURNISSEURS) {
      const proposes = REGISTRE_FOURNISSEURS[f].modelesProposes.map(m => m.id)
      for (const mode of MODES_LANGAGE) {
        expect(proposes).toContain(REGISTRE_FOURNISSEURS[f].modelesParDefaut[mode])
      }
    }
  })

  it('defauts Claude imposes', () => {
    expect(modelesParDefaut('anthropic')).toEqual({
      standard: 'claude-sonnet-5-5',
      profond: 'claude-opus-5-5',
      rapide: 'claude-haiku-5-5',
    })
  })

  it('reconnait uniquement les fournisseurs du registre', () => {
    expect(estFournisseur('openai')).toBe(true)
    expect(estFournisseur('mistral')).toBe(false)
    expect(estFournisseur(undefined)).toBe(false)
  })

  it('modelesParDefaut() sans argument couvre les 4 fournisseurs, aucun mode a null', () => {
    const tout = modelesParDefaut()
    expect(Object.keys(tout).sort()).toEqual([...FOURNISSEURS].sort())
    for (const f of FOURNISSEURS) {
      for (const mode of MODES_LANGAGE) {
        expect(typeof tout[f][mode]).toBe('string')
      }
      expect(tout[f]).toEqual(modelesParDefaut(f))
    }
    expect(tout.anthropic).toEqual(MODELES_CLAUDE_PAR_DEFAUT)
  })

  it('modelesParDefaut renvoie une copie', () => {
    const copie = modelesParDefaut('openai')
    copie.standard = 'x'
    expect(modelesParDefaut('openai').standard).toBe('gpt-6.1-sol')
  })
})
