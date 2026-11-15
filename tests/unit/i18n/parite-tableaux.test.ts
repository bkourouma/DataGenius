import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { locales } from '@/i18n/config'

type Arbre = { [cle: string]: string | Arbre }

function charger(langue: string): Arbre {
  return JSON.parse(readFileSync(resolve(__dirname, '../../../messages', langue, 'tableaux.json'), 'utf8'))
}

function feuilles(arbre: Arbre, prefixe = ''): Record<string, string> {
  return Object.entries(arbre).reduce<Record<string, string>>((acc, [cle, valeur]) => {
    const chemin = prefixe ? prefixe + '.' + cle : cle
    return typeof valeur === 'string' ? { ...acc, [chemin]: valeur } : { ...acc, ...feuilles(valeur, chemin) }
  }, {})
}

// Noms de variables ICU ({titre}, {count, plural, ...}) : les 6 langues doivent exposer les mêmes.
function variables(message: string): string[] {
  const noms = new Set<string>()
  let profondeur = 0
  let debut = -1
  for (let i = 0; i < message.length; i++) {
    if (message[i] === '{') {
      if (profondeur === 0) debut = i + 1
      profondeur++
    } else if (message[i] === '}') {
      profondeur--
      if (profondeur === 0 && debut >= 0) noms.add(message.slice(debut, i).split(',')[0].trim())
    }
  }
  return [...noms].sort()
}

// Balises de texte riche (<origine>...</origine>) : mêmes balises dans les 6 langues.
const balises = (message: string) => [...message.matchAll(/<(\w+)>/g)].map(m => m[1]).sort()

const fr = feuilles(charger('fr'))

describe('parité des messages tableaux.json', () => {
  it('le français n’est pas vide', () => {
    expect(Object.keys(fr).length).toBeGreaterThan(90)
  })

  it('expose les clés du groupe actions attendues par les actions serveur', () => {
    const attendues = ['sessionExpiree', 'tableauIntrouvable', 'versionIntrouvable', 'configurationInvalide', 'enregistrementImpossible', 'duplicationImpossible', 'suppressionImpossible', 'confirmationRequise']
    expect(Object.keys(fr).filter(c => c.startsWith('actions.')).map(c => c.slice(8)).sort()).toEqual(attendues.sort())
  })

  for (const langue of locales.filter(l => l !== 'fr')) {
    describe(langue, () => {
      const autre = feuilles(charger(langue))

      it('a exactement les mêmes clés que le français', () => {
        expect(Object.keys(autre).sort()).toEqual(Object.keys(fr).sort())
      })

      it('n’a aucune valeur vide', () => {
        expect(Object.entries(autre).filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([])
      })

      it('garde les mêmes variables ICU que le français', () => {
        const ecarts = Object.keys(fr).filter(k => autre[k] !== undefined && variables(autre[k]).join() !== variables(fr[k]).join())
        expect(ecarts).toEqual([])
      })

      it('garde les mêmes balises de texte riche que le français', () => {
        const ecarts = Object.keys(fr).filter(k => autre[k] !== undefined && balises(autre[k]).join() !== balises(fr[k]).join())
        expect(ecarts).toEqual([])
      })
    })
  }
})
