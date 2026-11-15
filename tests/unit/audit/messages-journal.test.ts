import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ACTIONS_AUDIT, cleTraductionAction } from '@/lib/audit/types'

const LANGUES = ['fr', 'en', 'es', 'ar', 'hi', 'zh'] as const
type Langue = (typeof LANGUES)[number]

const messages = Object.fromEntries(
  LANGUES.map(l => [l, JSON.parse(readFileSync(resolve(__dirname, `../../../messages/${l}/journal.json`), 'utf8'))]),
) as Record<Langue, Record<string, unknown>>

function aplatir(objet: unknown, prefixe = ''): Record<string, string> {
  const sortie: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(objet as Record<string, unknown>)) {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle
    if (valeur !== null && typeof valeur === 'object') Object.assign(sortie, aplatir(valeur, chemin))
    else sortie[chemin] = String(valeur)
  }
  return sortie
}

const plats = Object.fromEntries(LANGUES.map(l => [l, aplatir(messages[l])])) as Record<Langue, Record<string, string>>
const placeholders = (v: string) => [...v.matchAll(/\{(\w+)/g)].map(m => m[1]).sort()

describe('messages du journal', () => {
  it.each(LANGUES)('%s a exactement les mêmes clés que fr', (l) => {
    expect(Object.keys(plats[l]).sort()).toEqual(Object.keys(plats.fr).sort())
  })

  it.each(LANGUES)('%s : aucune valeur vide', (l) => {
    for (const [cle, valeur] of Object.entries(plats[l])) expect(valeur.trim(), `${l}:${cle}`).not.toBe('')
  })

  it.each(LANGUES)('%s : chaque action d’audit est traduite', (l) => {
    for (const code of ACTIONS_AUDIT) {
      expect(plats[l][`actions.${cleTraductionAction(code)}`], `${l}:${code}`).toBeTruthy()
    }
  })

  it('mêmes placeholders dans toutes les langues', () => {
    for (const cle of Object.keys(plats.fr)) {
      const attendu = placeholders(plats.fr[cle])
      for (const l of LANGUES) expect(placeholders(plats[l][cle]), `${l}:${cle}`).toEqual(attendu)
    }
  })

  it('es/ar/hi/zh ne sont pas des copies du français (valeurs de plus de 12 caractères)', () => {
    for (const l of ['es', 'ar', 'hi', 'zh'] as const) {
      for (const [cle, fr] of Object.entries(plats.fr)) {
        if (fr.length > 12) expect(plats[l][cle], `${l}:${cle}`).not.toBe(fr)
      }
    }
  })
})
