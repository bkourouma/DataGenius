import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const LANGUES = ['fr', 'en', 'es', 'ar', 'hi', 'zh'] as const

function charger(langue: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(__dirname, `../../../messages/${langue}/historique.json`), 'utf-8'))
}

const catalogues = Object.fromEntries(LANGUES.map(l => [l, charger(l)])) as Record<(typeof LANGUES)[number], Record<string, string>>
const clesFr = Object.keys(catalogues.fr).sort()

function variables(texte: string) {
  return [...texte.matchAll(/\{(\w+)[,}]/g)].map(m => m[1]).sort()
}

describe('historique.json', () => {
  it('contient des textes pour le français', () => {
    expect(clesFr.length).toBeGreaterThan(20)
  })

  it.each(LANGUES)('%s : mêmes clés que le français', langue => {
    expect(Object.keys(catalogues[langue]).sort()).toEqual(clesFr)
  })

  it.each(LANGUES)('%s : aucune valeur vide', langue => {
    for (const [cle, valeur] of Object.entries(catalogues[langue])) {
      expect(typeof valeur, cle).toBe('string')
      expect(valeur.trim(), cle).not.toBe('')
    }
  })

  it.each(LANGUES)('%s : mêmes variables ICU que le français', langue => {
    for (const cle of clesFr) expect(variables(catalogues[langue][cle]), `${langue}.${cle}`).toEqual(variables(catalogues.fr[cle]))
  })

  it.each(['es', 'ar', 'hi', 'zh'] as const)('%s : traduit, pas une copie du français', langue => {
    for (const cle of clesFr) {
      // Seules les valeurs sans aucune lettre latine (nombre, symbole) pourraient être identiques.
      if (!/[A-Za-zÀ-ÿ]{3,}/.test(catalogues.fr[cle].replace(/\{[^}]*\}/g, ''))) continue
      expect(catalogues[langue][cle], `${langue}.${cle} identique au français`).not.toBe(catalogues.fr[cle])
    }
  })

  it('arabe : toutes les catégories de pluriel', () => {
    for (const cle of ['resumeAjoutees', 'resumeRetirees', 'resumeModifiees']) {
      for (const categorie of ['zero', 'one', 'two', 'few', 'many', 'other']) {
        expect(catalogues.ar[cle], `${cle}.${categorie}`).toContain(`${categorie} {`)
      }
    }
  })
})
