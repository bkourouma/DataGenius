import { describe, expect, it } from 'vitest'

import { creerModele, optionsCachePrompt } from '@/lib/medic-assist/config/modeles'
import { ErreurFournisseurAbsent } from '@/lib/medic-assist/config/types'
import { FOURNISSEURS } from '@/lib/medic-assist/contrats'

const CLE_FACTICE = 'cle-factice-pour-test'

const ENV_PAR_FOURNISSEUR = {
  anthropic: { ANTHROPIC_API_KEY: CLE_FACTICE },
  openai: { OPENAI_API_KEY: CLE_FACTICE },
  google: { GOOGLE_GENERATIVE_AI_API_KEY: CLE_FACTICE },
  deepseek: { DEEPSEEK_API_KEY: CLE_FACTICE },
} as const

describe('creerModele', () => {
  it.each(FOURNISSEURS)('%s : leve ErreurFournisseurAbsent sans cle', fournisseur => {
    expect(() => creerModele(fournisseur, 'un-modele', {})).toThrow(ErreurFournisseurAbsent)
    expect(() => creerModele(fournisseur, 'un-modele', {})).toThrow(
      expect.objectContaining({ name: 'ErreurFournisseurAbsent' })
    )
  })

  it('traite une cle vide ou blanche comme absente', () => {
    expect(() => creerModele('openai', 'gpt-6-luna', { OPENAI_API_KEY: '' })).toThrow(
      ErreurFournisseurAbsent
    )
    expect(() => creerModele('openai', 'gpt-6-luna', { OPENAI_API_KEY: '  ' })).toThrow(
      ErreurFournisseurAbsent
    )
  })

  it.each(FOURNISSEURS)('%s : renvoie un modele portant l identifiant demande', fournisseur => {
    const modele = creerModele(fournisseur, 'modele-test', ENV_PAR_FOURNISSEUR[fournisseur])
    expect(typeof modele).toBe('object')
    expect((modele as { modelId: string }).modelId).toBe('modele-test')
  })

  it('le message d erreur ne contient aucune cle', () => {
    try {
      creerModele('anthropic', 'm', {})
    } catch (e) {
      expect((e as Error).message).not.toMatch(/API_KEY|sk-/)
    }
  })
})

describe('optionsCachePrompt', () => {
  it('pose un point de cache ephemere pour Anthropic seulement', () => {
    expect(optionsCachePrompt('anthropic')).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    })
    expect(optionsCachePrompt('openai')).toBeUndefined()
    expect(optionsCachePrompt('google')).toBeUndefined()
    expect(optionsCachePrompt('deepseek')).toBeUndefined()
  })
})
