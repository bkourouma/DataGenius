import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const langues = ['fr', 'en', 'es', 'ar', 'hi', 'zh'] as const
type Arbre = { [cle: string]: string | Arbre }

function lire(langue: string): Arbre {
  return JSON.parse(readFileSync(join(process.cwd(), 'messages', langue, 'etatWorker.json'), 'utf8')) as Arbre
}

function aplatir(arbre: Arbre, prefixe = ''): Record<string, string> {
  const sortie: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(arbre)) {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle
    if (typeof valeur === 'string') sortie[chemin] = valeur
    else Object.assign(sortie, aplatir(valeur, chemin))
  }
  return sortie
}

const placeholders = (texte: string) => [...texte.matchAll(/\{(\w+)/g)].map(m => m[1]).sort()

// Valeurs légitimement identiques au français (mots communs aux deux langues), liste minimale.
const IDENTIQUES_AU_FRANCAIS: Record<string, string[]> = {
  en: ['page.retour', 'page.version', 'page.colCode', 'page.colDate'],
}

const messages = Object.fromEntries(langues.map(l => [l, aplatir(lire(l))]))

describe('messages etatWorker', () => {
  it('le français n’est pas vide', () => {
    expect(Object.keys(messages.fr).length).toBeGreaterThan(20)
  })

  for (const langue of langues.filter(l => l !== 'fr')) {
    describe(langue, () => {
      it('mêmes clés que le français (récursif)', () => {
        expect(Object.keys(messages[langue]).sort()).toEqual(Object.keys(messages.fr).sort())
      })
      it('mêmes placeholders ICU par clé', () => {
        for (const [cle, valeur] of Object.entries(messages.fr)) {
          expect(placeholders(messages[langue][cle]), cle).toEqual(placeholders(valeur))
        }
      })
      it('aucune valeur vide', () => {
        for (const [cle, valeur] of Object.entries(messages[langue])) {
          expect(valeur.trim().length, cle).toBeGreaterThan(0)
        }
      })
      it('chaque valeur diffère du français, sauf exceptions explicites', () => {
        const exceptions = IDENTIQUES_AU_FRANCAIS[langue] ?? []
        for (const [cle, valeur] of Object.entries(messages[langue])) {
          if (exceptions.includes(cle)) expect(valeur, cle).toBe(messages.fr[cle])
          else expect(valeur, cle).not.toBe(messages.fr[cle])
        }
      })
    })
  }

  it('l’alerte contient le placeholder {duree} dans toutes les langues', () => {
    for (const langue of langues) expect(messages[langue]['bandeau.alerte']).toContain('{duree}')
  })
  it('es, ar, hi, zh ne reprennent pas l’anglais', () => {
    for (const langue of ['es', 'ar', 'hi', 'zh']) {
      for (const [cle, valeur] of Object.entries(messages[langue])) {
        expect(valeur, `${langue}.${cle}`).not.toBe(messages.en[cle])
      }
    }
  })
})
