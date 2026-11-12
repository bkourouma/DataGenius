import { describe, expect, it } from 'vitest'

import { REGISTRE_FOURNISSEURS } from '@/lib/medic-assist/config/fournisseurs'
import {
  TARIFS_AVEC_SOURCE,
  calculerCoutUsd,
  tarifModele,
  tarifsConnus,
} from '@/lib/medic-assist/config/tarifs'

describe('tarifModele', () => {
  it('renvoie le tarif du contrat, et null pour un modele inconnu', () => {
    expect(tarifModele('anthropic', 'claude-sonnet-5-5')).toEqual({
      fournisseur: 'anthropic',
      modele: 'claude-sonnet-5-5',
      entreeUsdParMillion: 2,
      sortieUsdParMillion: 10,
      cacheLectureUsdParMillion: 0.2,
      cacheEcritureUsdParMillion: 2.5,
    })
    expect(tarifModele('anthropic', 'claude-inconnu')).toBeNull()
    expect(tarifModele('google', 'gemini-4-argon')).toMatchObject({ entreeUsdParMillion: 2, sortieUsdParMillion: 10 })
  })

  it('chaque ligne porte une source et une date de verification', () => {
    for (const tarif of Object.values(TARIFS_AVEC_SOURCE)) {
      expect(tarif.source.length).toBeGreaterThan(0)
      expect(tarif.verifieLe).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('les trois modeles par defaut de Claude sont tarifes', () => {
    for (const modele of Object.values(REGISTRE_FOURNISSEURS.anthropic.modelesParDefaut)) {
      expect(tarifModele('anthropic', modele)).not.toBeNull()
    }
  })

  it('tarifsConnus liste tous les tarifs, sans source', () => {
    const liste = tarifsConnus()
    expect(liste).toHaveLength(Object.keys(TARIFS_AVEC_SOURCE).length)
    expect(liste.every(t => !('source' in t))).toBe(true)
    expect(liste.find(t => t.fournisseur === 'openai' && t.modele === 'gpt-6-luna')).toBeDefined()
  })
})

describe('calculerCoutUsd', () => {
  it('compte entree (hors cache), sortie, lecture et ecriture de cache', () => {
    // Sonnet : entree totale 3M dont 1M lecture (0,20) et 1M ecriture (2,50),
    // donc 1M simple (2,00) ; sortie 1M (10,00).
    expect(
      calculerCoutUsd('anthropic', 'claude-sonnet-5-5', {
        entree: 3_000_000,
        sortie: 1_000_000,
        cacheLecture: 1_000_000,
        cacheEcriture: 1_000_000,
      })
    ).toBe(14.7)
  })

  it('sans cache, entree et sortie seulement', () => {
    expect(calculerCoutUsd('anthropic', 'claude-sonnet-5-5', { entree: 500_000, sortie: 0 })).toBe(
      1
    )
  })

  it('le raisonnement est deja dans la sortie : il ne s ajoute pas', () => {
    const base = { entree: 0, sortie: 1_000_000 }
    expect(calculerCoutUsd('anthropic', 'claude-sonnet-5-5', base)).toBe(10)
    expect(calculerCoutUsd('anthropic', 'claude-sonnet-5-5', { ...base, raisonnement: 400_000 })).toBe(
      10
    )
  })

  it('arrondit a 6 decimales', () => {
    // Haiku : entree simple 12345-9999-321 = 2025 -> 202,5 ; lecture 9999 -> 99,99 ;
    // ecriture 321 -> 40,125 ; sortie 678 -> 339 ; total 681,615 / 1e6 = 0,000681615
    expect(
      calculerCoutUsd('anthropic', 'claude-haiku-5-5', {
        entree: 12_345,
        sortie: 678,
        cacheLecture: 9_999,
        cacheEcriture: 321,
      })
    ).toBe(0.000682)
  })

  it('ne facture jamais une entree negative si le cache depasse l entree', () => {
    expect(
      calculerCoutUsd('anthropic', 'claude-sonnet-5-5', {
        entree: 100,
        sortie: 0,
        cacheLecture: 1_000_000,
      })
    ).toBe(0.2)
  })

  it('renvoie 0 pour une consommation nulle et null pour un tarif inconnu', () => {
    const zero = { entree: 0, sortie: 0 }
    expect(calculerCoutUsd('openai', 'gpt-6-luna', zero)).toBe(0)
    expect(calculerCoutUsd('openai', 'gpt-inconnu', zero)).toBeNull()
  })
})
