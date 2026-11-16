import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const LANGUES = ['fr', 'en', 'es', 'ar', 'hi', 'zh'] as const
const AUTRES = LANGUES.filter((l) => l !== 'fr')
type Arbre = { [cle: string]: string | Arbre }

function charger(langue: string): Arbre {
  return JSON.parse(readFileSync(resolve(__dirname, `../../../messages/${langue}/ecrans.json`), 'utf8'))
}

function aplatir(arbre: Arbre, prefixe = ''): Record<string, string> {
  const sortie: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(arbre)) {
    if (typeof valeur === 'string') sortie[prefixe + cle] = valeur
    else Object.assign(sortie, aplatir(valeur, prefixe + cle + '.'))
  }
  return sortie
}

/** Noms des variables ICU de premier niveau : {nom}, {count, plural, ...}. Les branches sont ignorées. */
function variables(message: string): string[] {
  const noms = new Set<string>()
  let profondeur = 0
  let debut = -1
  for (let i = 0; i < message.length; i++) {
    const c = message[i]
    if (c === '{') {
      if (profondeur === 0) debut = i + 1
      profondeur++
    } else if (c === '}') {
      profondeur--
      if (profondeur === 0 && debut >= 0) {
        const nom = message.slice(debut, i).split(',')[0].trim()
        if (nom) noms.add(nom)
        debut = -1
      }
    }
  }
  return [...noms].sort()
}

const jeux = Object.fromEntries(LANGUES.map((l) => [l, aplatir(charger(l))])) as Record<(typeof LANGUES)[number], Record<string, string>>
const clesFr = Object.keys(jeux.fr).sort()

function mots(texte: string): number {
  return texte.replace(/Data Genius/g, '').split(/\s+/).filter(Boolean).length
}

describe('messages/*/ecrans.json : parité des langues', () => {
  it('le français contient des clés', () => {
    expect(clesFr.length).toBeGreaterThan(0)
  })

  it.each(AUTRES)('%s : mêmes clés exactes que le français', (langue) => {
    expect(Object.keys(jeux[langue]).sort()).toEqual(clesFr)
  })

  it.each(LANGUES)('%s : aucune valeur vide', (langue) => {
    const vides = Object.entries(jeux[langue]).filter(([, v]) => v.trim() === '').map(([k]) => k)
    expect(vides).toEqual([])
  })

  it.each(AUTRES)('%s : mêmes variables ICU que le français', (langue) => {
    const ecarts = clesFr.filter((cle) => JSON.stringify(variables(jeux[langue][cle] ?? '')) !== JSON.stringify(variables(jeux.fr[cle])))
    expect(ecarts).toEqual([])
  })

  it.each(AUTRES)('%s : aucune phrase d’au moins 4 mots laissée en français', (langue) => {
    const oublis = clesFr.filter((cle) => mots(jeux.fr[cle]) >= 4 && jeux[langue][cle] === jeux.fr[cle])
    expect(oublis).toEqual([])
  })
})
