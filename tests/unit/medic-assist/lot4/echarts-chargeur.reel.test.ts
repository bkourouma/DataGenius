/**
 * VRAI echarts 6 (aucun double) : `chargerEcharts()` enregistre les modules, puis chacune des
 * 13 formes produite par `construireOptionGraphique` est acceptée par une instance SVG rendue
 * côté serveur (`ssr: true`) et donne un `<svg` sans exception, en clair, en sombre, en
 * compact, en statique et en arabe (RTL).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { chargerEcharts, type InstanceEcharts } from '@/components/medic-assist/artefacts/echarts-chargeur'
import { construireOptionGraphique } from '@/lib/medic-assist/artefacts/graphique-option'
import type { ContexteGraphique, JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'
import {
  FORMES_GRAPHIQUE,
  type ColonneJeu,
  type FormeGraphique,
  type GraphiqueSpec,
} from '@/lib/medic-assist/contrats'

type Rec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const messages = JSON.parse(
  readFileSync(resolve(process.cwd(), 'messages', 'fr', 'medicAssistArtefacts.json'), 'utf8')
) as Rec

function chercher(cle: string): string | undefined {
  let n: unknown = messages
  for (const p of cle.split('.')) n = (n as Rec | undefined)?.[p]
  return typeof n === 'string' ? n : undefined
}

function contexte(extra: Partial<ContexteGraphique> = {}): ContexteGraphique {
  return {
    locale: 'fr',
    theme: 'clair',
    rtl: false,
    traduire: (cle, valeurs) => {
      const t = chercher(cle)
      if (t === undefined) throw new Error(`clé manquante : ${cle}`)
      return t.replace(/\{(\w+)(?:,[^}]*(?:\{[^}]*\}[^}]*)*)?\}/g, (m, k) =>
        valeurs && k in valeurs ? String(valeurs[k]) : m
      )
    },
    ...extra,
  }
}

const COLONNES: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'periode', libelle: 'Période', type: 'periode' },
  { cle: 'canal', libelle: 'Canal', type: 'texte' },
  { cle: 'ca', libelle: "Chiffre d'affaires", type: 'montant' },
  { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
  { cle: 'qte', libelle: 'Quantité', type: 'entier' },
]

function lignes(): Record<string, unknown>[] {
  const pays = ['France', 'Mali', 'Togo', 'Sénégal', 'Bénin']
  const canaux = ['Pharmacie', 'Grossiste']
  const mois = ['2026-04', '2026-05', '2026-06', '2026-07']
  const sortie: Record<string, unknown>[] = []
  let k = 1
  for (const p of pays)
    for (const c of canaux)
      for (const m of mois) {
        sortie.push({ pays: p, canal: c, periode: m, ca: 100 * k, taux: 20 + (k % 70), qte: k * 3 })
        k++
      }
  return sortie
}

const JEU: JeuClient = (() => {
  const l = lignes()
  return {
    jeuDeDonneesId: 'j1',
    colonnes: COLONNES,
    lignes: l,
    nbLignes: l.length,
    tronque: false,
    // B-1 : la jauge lit le total du jeu (jamais la première ligne d'un jeu de plusieurs lignes).
    totaux: { taux: 70 },
    provenance: {} as never,
  }
})()

const SPECS: Record<FormeGraphique, GraphiqueSpec> = {
  barres: { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] },
  barres_empilees: {
    forme: 'barres_empilees',
    x: 'periode',
    y: [{ cle: 'ca' }],
    serie: 'canal',
    empile: true,
  },
  barres_horizontales: { forme: 'barres_horizontales', x: 'pays', y: [{ cle: 'ca' }, { cle: 'qte' }] },
  lignes: { forme: 'lignes', x: 'periode', y: [{ cle: 'ca' }], serie: 'canal' },
  aires: { forme: 'aires', x: 'periode', y: [{ cle: 'ca' }], serie: 'canal', empile: true },
  secteurs: { forme: 'secteurs', x: 'pays', y: [{ cle: 'ca' }] },
  anneau: { forme: 'anneau', x: 'canal', y: [{ cle: 'ca' }] },
  nuage: { forme: 'nuage', x: 'qte', y: [{ cle: 'ca' }], serie: 'canal' },
  combine: {
    forme: 'combine',
    x: 'periode',
    y: [
      { cle: 'ca', forme: 'barres', axe: 'gauche' },
      { cle: 'taux', forme: 'lignes', axe: 'droite' },
    ],
  },
  carte_chaleur: { forme: 'carte_chaleur', x: 'pays', y: [{ cle: 'ca' }], serie: 'periode' },
  treemap: { forme: 'treemap', x: 'pays', y: [{ cle: 'ca' }] },
  entonnoir: { forme: 'entonnoir', x: 'pays', y: [{ cle: 'ca' }] },
  jauge: { forme: 'jauge', x: 'pays', y: [{ cle: 'taux' }] },
}

const VARIANTES: Array<[string, Partial<ContexteGraphique>]> = [
  ['clair', {}],
  ['sombre', { theme: 'sombre' }],
  ['compact', { compact: true }],
  ['statique', { statique: true }],
  ['arabe (RTL)', { locale: 'ar', rtl: true }],
]

// tests/setup.ts impose jsdom, qui n'a pas de canvas : zrender retombe alors sur sa table de
// largeurs de caractères, comme sur un serveur.
beforeAll(() => {
  if (typeof HTMLCanvasElement !== 'undefined') {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  }
})

const instances: InstanceEcharts[] = []
afterAll(() => {
  for (const i of instances) i.dispose()
})

describe('chargerEcharts() avec le vrai paquet', () => {
  it('expose init et accepte une instance SVG rendue côté serveur', async () => {
    const echarts = await chargerEcharts()
    expect(typeof echarts.init).toBe('function')
    const instance = echarts.init(null, null, {
      renderer: 'svg',
      ssr: true,
      width: 400,
      height: 300,
    }) as InstanceEcharts
    instances.push(instance)
    instance.setOption({ xAxis: { type: 'category', data: ['a'] }, yAxis: {}, series: [{ type: 'bar', data: [1] }] })
    expect(instance.renderToSVGString?.()).toContain('<svg')
  }, 60_000)

  it('est partagé : deux appels donnent le même module', async () => {
    expect(await chargerEcharts()).toBe(await chargerEcharts())
  })
})

describe.each(FORMES_GRAPHIQUE)('forme %s avec le vrai echarts', forme => {
  it.each(VARIANTES)('rend un <svg> (%s)', async (_nom, extra) => {
    const echarts = await chargerEcharts()
    const resultat = construireOptionGraphique(SPECS[forme], JEU, contexte(extra))
    expect(resultat.vide).toBe(false)
    expect(resultat.formeEffective).toBe(forme)

    const instance = echarts.init(null, null, {
      renderer: 'svg',
      ssr: true,
      width: 400,
      height: 300,
    }) as InstanceEcharts
    instances.push(instance)
    // ECharts signale ses options invalides par console.error / console.warn (« [ECharts] … »).
    const avertissements: string[] = []
    const garder = (...args: unknown[]) => void avertissements.push(args.map(String).join(' '))
    const espions = [
      vi.spyOn(console, 'warn').mockImplementation(garder),
      vi.spyOn(console, 'error').mockImplementation(garder),
    ]
    let svg = ''
    try {
      expect(() => instance.setOption(resultat.option, { notMerge: true })).not.toThrow()
      svg = instance.renderToSVGString?.() ?? ''
    } finally {
      for (const e of espions) e.mockRestore()
    }
    expect(avertissements.filter(a => a.includes('ECharts'))).toEqual([])
    expect(svg).toContain('<svg')
    expect(svg.length).toBeGreaterThan(500)
  })
})
