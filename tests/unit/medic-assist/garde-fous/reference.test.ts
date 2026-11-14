import { describe, expect, it } from 'vitest'

import {
  ALPHABET_REFERENCE,
  FORMAT_REFERENCE,
  genererReference,
} from '@/lib/medic-assist/agent/reference'

describe('genererReference', () => {
  it('respecte le format DG-XXXXXX sans caractère ambigu', () => {
    for (let i = 0; i < 200; i += 1) {
      const reference = genererReference()
      expect(reference).toMatch(FORMAT_REFERENCE)
      expect(reference.slice(3)).not.toMatch(/[01OI]/)
    }
  })

  it('utilise un alphabet de 32 symboles', () => {
    expect(new Set(ALPHABET_REFERENCE).size).toBe(32)
  })

  it('produit des références distinctes', () => {
    const vues = new Set(Array.from({ length: 2000 }, () => genererReference()))
    expect(vues.size).toBeGreaterThan(1990)
  })
})
