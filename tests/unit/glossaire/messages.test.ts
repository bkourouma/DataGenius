import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const LANGUES = ['fr', 'en', 'es', 'ar', 'hi', 'zh'] as const
type Arbre = { [cle: string]: string | Arbre }

const charger = (langue: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../messages/${langue}/glossaire.json`), 'utf8')) as Arbre

function cles(arbre: Arbre, prefixe = ''): string[] {
  return Object.entries(arbre).flatMap(([cle, valeur]) =>
    typeof valeur === 'string' ? [prefixe + cle] : cles(valeur, `${prefixe}${cle}.`))
}

function feuilles(arbre: Arbre): Map<string, string> {
  const resultat = new Map<string, string>()
  const parcourir = (noeud: Arbre, prefixe: string) => {
    for (const [cle, valeur] of Object.entries(noeud)) {
      if (typeof valeur === 'string') resultat.set(prefixe + cle, valeur)
      else parcourir(valeur, `${prefixe}${cle}.`)
    }
  }
  parcourir(arbre, '')
  return resultat
}

const variables = (texte: string) => [...new Set([...texte.matchAll(/\{(\w+)[,}]/g)].map(m => m[1]!))].sort()

describe('messages du glossaire', () => {
  const reference = charger('fr')
  const clesFr = cles(reference).sort()

  it('expose les clés racine commentaires, page et recherche', () => {
    expect(Object.keys(reference).sort()).toEqual(['commentaires', 'page', 'recherche'])
  })

  it.each(LANGUES)('%s a exactement les mêmes clés que le français', langue => {
    expect(cles(charger(langue)).sort()).toEqual(clesFr)
  })

  it.each(LANGUES)('%s n’a aucune valeur vide ni emoji', langue => {
    for (const [cle, valeur] of feuilles(charger(langue))) {
      expect(valeur.trim(), cle).not.toBe('')
      expect(/\p{Extended_Pictographic}/u.test(valeur), cle).toBe(false)
    }
  })

  it.each(LANGUES.filter(l => l !== 'fr'))('%s reprend les mêmes variables ICU que le français et diffère du français', langue => {
    const fr = feuilles(reference)
    for (const [cle, valeur] of feuilles(charger(langue))) {
      expect(variables(valeur), cle).toEqual(variables(fr.get(cle)!))
    }
    // Des vraies traductions : la grande majorité des textes diffère du français.
    const traduit = charger(langue)
    const identiques = [...feuilles(traduit)].filter(([cle, valeur]) => valeur === fr.get(cle))
    expect(identiques.length).toBeLessThanOrEqual(4)
  })
})
