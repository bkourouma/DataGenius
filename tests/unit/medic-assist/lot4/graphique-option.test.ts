import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ColonneJeu, GraphiqueSpec } from '@/lib/medic-assist/contrats'
import { echapperHtml, construireOptionGraphique } from '@/lib/medic-assist/artefacts/graphique-option'
import { creerFormateur } from '@/lib/medic-assist/artefacts/formats'
import { couleursSeries, jetons } from '@/lib/medic-assist/artefacts/palette'
import type { ContexteGraphique, JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

type Rec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const messages = JSON.parse(
  readFileSync(resolve(process.cwd(), 'messages', 'fr', 'medicAssistArtefacts.json'), 'utf8')
) as Rec

function chercher(cle: string): string | undefined {
  let n: unknown = messages
  for (const p of cle.split('.')) n = (n as Rec | undefined)?.[p]
  return typeof n === 'string' ? n : undefined
}

function contexte(extra: Partial<ContexteGraphique> = {}, cles?: Set<string>): ContexteGraphique {
  return {
    locale: 'fr',
    theme: 'clair',
    rtl: false,
    traduire: (cle, valeurs) => {
      cles?.add(cle)
      const t = chercher(cle)
      if (t === undefined) throw new Error(`clé manquante : ${cle}`)
      return t.replace(/\{(\w+)(?:,[^}]*(?:\{[^}]*\}[^}]*)*)?\}/g, (m, k) =>
        valeurs && k in valeurs ? String(valeurs[k]) : m
      )
    },
    ...extra,
  }
}

const COLS: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'periode', libelle: 'Période', type: 'periode' },
  { cle: 'canal', libelle: 'Canal', type: 'texte' },
  { cle: 'ca', libelle: 'Chiffre d\'affaires', type: 'montant' },
  { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
  { cle: 'qte', libelle: 'Quantité', type: 'entier' },
]

function jeu(lignes: Record<string, unknown>[], totaux?: Record<string, number>): JeuClient {
  return {
    jeuDeDonneesId: 'j1',
    colonnes: COLS,
    lignes,
    nbLignes: lignes.length,
    tronque: false,
    totaux,
    provenance: {} as never,
  }
}

const PAYS = [
  { pays: 'France', ca: 100, taux: 80, qte: 1, periode: '2026-05', canal: 'A' },
  { pays: 'Mali', ca: 300, taux: 60, qte: 3, periode: '2026-04', canal: 'A' },
  { pays: 'France', ca: 50, taux: 100, qte: 2, periode: '2026-04', canal: 'B' },
  { pays: 'Togo', ca: 20, taux: 40, qte: 5, periode: '2026-06', canal: 'B' },
]

const spec = (s: Partial<GraphiqueSpec> & Pick<GraphiqueSpec, 'forme'>): GraphiqueSpec => ({
  x: 'pays',
  y: [{ cle: 'ca' }],
  ...s,
})

function nPays(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    pays: `Pays ${String(i + 1).padStart(2, '0')}`,
    ca: (i + 1) * 10,
    taux: 50 + i,
    qte: i,
    periode: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
    canal: 'A',
  }))
}

describe('barres et agrégation', () => {
  it('agrège par catégorie (somme) dans l\'ordre d\'apparition', () => {
    const r = construireOptionGraphique(spec({ forme: 'barres' }), jeu(PAYS), contexte())
    const o = r.option as Rec
    expect(r.vide).toBe(false)
    expect(r.formeEffective).toBe('barres')
    expect(o.xAxis.data).toEqual(['France', 'Mali', 'Togo'])
    expect(o.series).toHaveLength(1)
    expect(o.series[0].type).toBe('bar')
    expect(o.series[0].data).toEqual([150, 300, 20])
    expect(o.series[0].name).toBe("Chiffre d'affaires")
  })

  it('moyenne pour un pourcentage', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', y: [{ cle: 'taux' }] }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.series[0].data).toEqual([90, 60, 40])
  })

  it('plusieurs mesures : une série chacune, légende affichée dès 2 séries', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', y: [{ cle: 'ca' }, { cle: 'qte', libelle: 'Qté' }] }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.series.map((s: Rec) => s.name)).toEqual(["Chiffre d'affaires", 'Qté'])
    expect(o.legend.show).toBe(true)
    expect(o.aria.decal.show).toBe(true)
  })

  it('une seule série : légende cachée, pas de motifs, étiquettes de valeur', () => {
    const o = construireOptionGraphique(spec({ forme: 'barres' }), jeu(PAYS), contexte()).option as Rec
    expect(o.legend.show).toBe(false)
    expect(o.aria.decal.show).toBe(false)
    expect(o.aria.enabled).toBe(true)
    expect(o.series[0].label.show).toBe(true)
    expect(o.series[0].label.formatter({ value: 150 })).toBe(creerFormateur('montant', 'fr')(150))
    expect(o.series[0].label.formatter({ value: null })).toBe('')
  })

  it('pas d\'étiquettes au-delà de 12 marques', () => {
    const o = construireOptionGraphique(spec({ forme: 'barres' }), jeu(nPays(13)), contexte()).option as Rec
    expect(o.series[0].label.show).toBe(false)
  })

  it('serie éclate la mesure : une série par valeur, libellé = valeur', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', serie: 'canal' }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.series.map((s: Rec) => s.name)).toEqual(['A', 'B'])
    expect(o.series[0].data).toEqual([100, 300, null])
    expect(o.series[1].data).toEqual([50, null, 20])
    expect(o.legend.show).toBe(true)
    expect(o.aria.decal.show).toBe(true)
  })

  it('plusieurs y avec serie : première mesure seulement + avertissement', () => {
    const r = construireOptionGraphique(
      spec({ forme: 'barres', serie: 'canal', y: [{ cle: 'ca' }, { cle: 'qte' }] }),
      jeu(PAYS),
      contexte()
    )
    expect((r.option as Rec).series).toHaveLength(2)
    expect(r.avertissements.map(a => a.code)).toContain('serie_ignoree')
  })

  it('barres empilées : même pile, total dans l\'infobulle', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres_empilees', serie: 'canal' }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.series.every((s: Rec) => s.stack === 'pile-gauche')).toBe(true)
    expect(o.series[0].label.show).toBe(false)
    const html = o.tooltip.formatter([
      { seriesIndex: 0, seriesName: 'A', value: 100, axisValueLabel: 'France', marker: '' },
      { seriesIndex: 1, seriesName: 'B', value: 50, axisValueLabel: 'France', marker: '' },
    ])
    expect(html).toContain('Total')
    expect(html).toContain(creerFormateur('montant', 'fr')(150))
  })

  it('empile=true sur des barres', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', serie: 'canal', empile: true }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.series[0].stack).toBeDefined()
  })
})

describe('ordre des catégories', () => {
  it('chronologique pour une période, quel que soit l\'ordre des lignes', () => {
    const r = construireOptionGraphique(
      spec({ forme: 'lignes', x: 'periode' }),
      jeu(PAYS),
      contexte()
    )
    const o = r.option as Rec
    expect(o.xAxis.data).toEqual(
      ['2026-04', '2026-05', '2026-06'].map(p => creerFormateur('periode', 'fr')(p))
    )
    expect(o.series[0].data).toEqual([350, 100, 20])
    expect(o.series[0].type).toBe('line')
    expect(o.xAxis.data[0]).toMatch(/avr/i)
    expect(o.xAxis.data[0]).toContain('2026')
  })

  it('trierPar une mesure, sens asc', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', trierPar: 'ca', sens: 'asc' }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.xAxis.data).toEqual(['Togo', 'France', 'Mali'])
  })

  it('trierPar une mesure sans sens : décroissant', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', trierPar: 'ca' }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.xAxis.data).toEqual(['Mali', 'France', 'Togo'])
  })

  it('trierPar la dimension', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', trierPar: 'pays', sens: 'desc' }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.xAxis.data).toEqual(['Togo', 'Mali', 'France'])
  })

  it('classement : décroissant, plus grande valeur en haut', () => {
    const r = construireOptionGraphique(spec({ forme: 'barres_horizontales' }), jeu(PAYS), contexte())
    const o = r.option as Rec
    expect(o.yAxis.type).toBe('category')
    expect(o.yAxis.data).toEqual(['Mali', 'France', 'Togo'])
    expect(o.yAxis.inverse).toBe(true)
    expect(o.xAxis.type).toBe('value')
    expect(o.series[0].data).toEqual([300, 150, 20])
  })
})

describe('ordre par défaut (A-Z)', () => {
  const DESORDRE = [
    { pays: 'Togo', ca: 20, taux: 40, qte: 5, periode: '2026-06', canal: 'A' },
    { pays: 'Égypte', ca: 70, taux: 40, qte: 5, periode: '2026-05', canal: 'A' },
    { pays: 'Zambie', ca: 70, taux: 40, qte: 5, periode: '2026-04', canal: 'A' },
    { pays: 'Mali', ca: 300, taux: 60, qte: 3, periode: '2026-04', canal: 'A' },
    { pays: 'Pays 10', ca: 1, taux: 1, qte: 1, periode: '2026-07', canal: 'A' },
    { pays: 'Pays 2', ca: 2, taux: 1, qte: 1, periode: '2026-08', canal: 'A' },
  ]
  const AZ = ['Égypte', 'Mali', 'Pays 2', 'Pays 10', 'Togo', 'Zambie']

  it.each(['barres', 'barres_empilees', 'combine'] as const)(
    '%s à abscisse catégorielle : libellés de A à Z, accents et nombres naturels',
    forme => {
      const s = spec({
        forme,
        ...(forme === 'combine' ? { y: [{ cle: 'ca' }, { cle: 'taux', axe: 'droite' }] } : {}),
      } as never)
      const o = construireOptionGraphique(s, jeu(DESORDRE), contexte()).option as Rec
      expect(o.xAxis.data).toEqual(AZ)
    }
  )

  it.each(['ar', 'zh', 'hi'])('locale %s : aucune exception, toutes les catégories gardées', locale => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres' }),
      jeu(DESORDRE),
      contexte({ locale })
    ).option as Rec
    expect([...o.xAxis.data].sort()).toEqual([...AZ].sort())
  })

  it('abscisse temporelle : chronologique, inversée par sens desc', () => {
    const asc = construireOptionGraphique(
      spec({ forme: 'barres', x: 'periode' }),
      jeu(DESORDRE),
      contexte()
    ).option as Rec
    const libelles = asc.xAxis.data as string[]
    expect(libelles).toHaveLength(5)
    const desc = construireOptionGraphique(
      spec({ forme: 'barres', x: 'periode', sens: 'desc' }),
      jeu(DESORDRE),
      contexte()
    ).option as Rec
    expect(desc.xAxis.data).toEqual([...libelles].reverse())
  })

  it('classement : valeur décroissante, égalités départagées par libellé', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres_horizontales' }),
      jeu(DESORDRE),
      contexte()
    ).option as Rec
    expect(o.yAxis.data).toEqual(['Mali', 'Égypte', 'Zambie', 'Togo', 'Pays 2', 'Pays 10'])
  })

  it('trierPar et sens explicites priment', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', trierPar: 'ca', sens: 'desc' }),
      jeu(DESORDRE),
      contexte()
    ).option as Rec
    expect(o.xAxis.data).toEqual(['Mali', 'Égypte', 'Zambie', 'Togo', 'Pays 2', 'Pays 10'])
    const az = construireOptionGraphique(
      spec({ forme: 'barres', trierPar: 'pays', sens: 'desc' }),
      jeu(DESORDRE),
      contexte()
    ).option as Rec
    expect(az.xAxis.data).toEqual([...AZ].reverse())
  })

  it('top N sur barres : N plus grandes valeurs, remises de A à Z, Autres en dernier', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', limite: 3 }),
      jeu(DESORDRE),
      contexte()
    ).option as Rec
    expect(o.xAxis.data).toEqual(['Égypte', 'Mali', 'Zambie', 'Autres'])
  })

  it('top N sur un classement : reste trié par valeur', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres_horizontales', limite: 3 }),
      jeu(DESORDRE),
      contexte()
    ).option as Rec
    expect(o.yAxis.data).toEqual(['Mali', 'Égypte', 'Zambie', 'Autres'])
  })
})

describe('limite : top N et Autres', () => {
  it('regroupe le reste en Autres pour une mesure additive', () => {
    const r = construireOptionGraphique(spec({ forme: 'barres', limite: 2 }), jeu(nPays(5)), contexte())
    const o = r.option as Rec
    // top 2 par valeur, puis remis de A à Z, « Autres » en dernier
    expect(o.xAxis.data).toEqual(['Pays 04', 'Pays 05', 'Autres'])
    expect(o.series[0].data).toEqual([40, 50, 10 + 20 + 30])
    expect(r.avertissements).toContainEqual({ code: 'limite_appliquee', valeurs: { n: 2, total: 5 } })
  })

  it('pas d\'Autres pour un pourcentage : catégories omises', () => {
    const r = construireOptionGraphique(
      spec({ forme: 'barres', limite: 2, y: [{ cle: 'taux' }] }),
      jeu(nPays(5)),
      contexte()
    )
    const o = r.option as Rec
    expect(o.xAxis.data).toEqual(['Pays 04', 'Pays 05'])
    expect(r.avertissements.map(a => a.code)).toEqual(['limite_appliquee'])
  })

  it('mesure additive + pourcentage : Autres vide pour le pourcentage', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', limite: 1, y: [{ cle: 'ca' }, { cle: 'taux' }] }),
      jeu(nPays(3)),
      contexte()
    ).option as Rec
    expect(o.xAxis.data).toEqual(['Pays 03', 'Autres'])
    expect(o.series[0].data).toEqual([30, 30])
    expect(o.series[1].data).toEqual([52, null])
  })

  it('respecte trierPar pour choisir les N premiers', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', limite: 2, trierPar: 'ca', sens: 'asc' }),
      jeu(nPays(5)),
      contexte()
    ).option as Rec
    expect(o.xAxis.data).toEqual(['Pays 01', 'Pays 02', 'Autres'])
  })

  it('jamais d\'Autres en ordre chronologique : omission des plus anciennes', () => {
    const lignes = ['2026-01', '2026-02', '2026-03', '2026-04'].map((p, i) => ({
      periode: p,
      ca: (i + 1) * 10,
    }))
    const r = construireOptionGraphique(
      { forme: 'lignes', x: 'periode', y: [{ cle: 'ca' }], limite: 2 },
      jeu(lignes),
      contexte()
    )
    const o = r.option as Rec
    expect(o.xAxis.data).toHaveLength(2)
    expect(o.series[0].data).toEqual([30, 40])
    expect(JSON.stringify(o.xAxis.data)).not.toContain('Autres')
    expect(r.avertissements[0]).toEqual({ code: 'limite_appliquee', valeurs: { n: 2, total: 4 } })
  })

  it('aucun avertissement si la limite n\'est pas dépassée', () => {
    const r = construireOptionGraphique(spec({ forme: 'barres', limite: 10 }), jeu(PAYS), contexte())
    expect(r.avertissements).toEqual([])
  })

  it('Autres avec serie agrège par série', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', serie: 'canal', limite: 1 }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.xAxis.data).toEqual(['Mali', 'Autres'])
    expect(o.series.find((s: Rec) => s.name === 'B').data).toEqual([null, 70])
  })
})

describe('formes inadaptées et vide', () => {
  it('secteurs > 8 catégories : repli sur barres horizontales', () => {
    const r = construireOptionGraphique(spec({ forme: 'secteurs' }), jeu(nPays(9)), contexte())
    expect(r.formeEffective).toBe('barres_horizontales')
    expect(r.avertissements).toContainEqual({
      code: 'forme_changee',
      valeurs: { de: 'secteurs', vers: 'barres_horizontales', n: 9 },
    })
    expect((r.option as Rec).yAxis.type).toBe('category')
  })

  it('anneau à 8 catégories : conservé', () => {
    const r = construireOptionGraphique(spec({ forme: 'anneau' }), jeu(nPays(8)), contexte())
    expect(r.formeEffective).toBe('anneau')
    expect(r.avertissements).toEqual([])
  })

  it('anneau + limite 5 sur 12 catégories : pas de repli, Autres présent', () => {
    const r = construireOptionGraphique(spec({ forme: 'anneau', limite: 5 }), jeu(nPays(12)), contexte())
    expect(r.formeEffective).toBe('anneau')
    const noms = (r.option as Rec).series[0].data.map((d: Rec) => d.name)
    expect(noms).toHaveLength(6)
    expect(noms[5]).toBe('Autres')
  })

  it('forme à une mesure avec plusieurs y : première seulement', () => {
    const r = construireOptionGraphique(
      spec({ forme: 'secteurs', y: [{ cle: 'ca' }, { cle: 'qte' }] }),
      jeu(PAYS),
      contexte()
    )
    expect(r.avertissements).toContainEqual({ code: 'serie_ignoree', valeurs: { n: 1, forme: 'secteurs' } })
    expect((r.option as Rec).series).toHaveLength(1)
  })

  it('jeu sans ligne : vide, option minimale valide', () => {
    const r = construireOptionGraphique(spec({ forme: 'barres' }), jeu([]), contexte())
    expect(r.vide).toBe(true)
    expect(r.avertissements).toEqual([{ code: 'donnees_vides' }])
    const o = r.option as Rec
    expect(o.series).toEqual([])
    expect(o.title[0].text).toBe('Aucune donnée à afficher')
  })

  it('mesure sans aucune valeur numérique : vide', () => {
    const r = construireOptionGraphique(
      spec({ forme: 'barres' }),
      jeu([{ pays: 'X', ca: null }]),
      contexte()
    )
    expect(r.vide).toBe(true)
  })

  it('secteurs sans valeur positive : vide', () => {
    const r = construireOptionGraphique(spec({ forme: 'secteurs' }), jeu([{ pays: 'X', ca: 0 }]), contexte())
    expect(r.vide).toBe(true)
  })
})

describe('secteurs, anneau, treemap, entonnoir', () => {
  it('secteurs : données nom / valeur triées, légende, étiquettes', () => {
    const o = construireOptionGraphique(spec({ forme: 'secteurs' }), jeu(PAYS), contexte()).option as Rec
    expect(o.series[0].type).toBe('pie')
    expect(o.series[0].data).toEqual([
      { name: 'Mali', value: 300 },
      { name: 'France', value: 150 },
      { name: 'Togo', value: 20 },
    ])
    expect(o.legend.show).toBe(true)
    expect(o.series[0].label.formatter({ name: 'Mali', percent: 63.8 })).toMatch(/^63,8\s%$/)
    expect(o.aria.decal.show).toBe(true)
  })

  it('anneau : rayon intérieur et total au centre', () => {
    const o = construireOptionGraphique(spec({ forme: 'anneau' }), jeu(PAYS), contexte()).option as Rec
    expect(o.series[0].radius).toEqual(['45%', '70%'])
    const centre = o.title.find((t: Rec) => t.subtext)
    expect(centre.subtext).toBe('Total')
    expect(centre.text).toBe(creerFormateur('montant', 'fr')(470))
  })

  it('treemap : un niveau, étiquettes nom + valeur formatée, pas de légende', () => {
    const o = construireOptionGraphique(spec({ forme: 'treemap' }), jeu(PAYS), contexte()).option as Rec
    expect(o.series[0].type).toBe('treemap')
    expect(o.series[0].data).toHaveLength(3)
    expect(o.legend.show).toBe(false)
    expect(o.series[0].label.formatter({ name: 'Mali', value: 300 })).toBe(
      `Mali\n${creerFormateur('montant', 'fr')(300)}`
    )
  })

  it('entonnoir : décroissant', () => {
    const r = construireOptionGraphique(spec({ forme: 'entonnoir' }), jeu(PAYS), contexte())
    const o = r.option as Rec
    expect(o.series[0].type).toBe('funnel')
    expect(o.series[0].sort).toBe('descending')
    expect(o.series[0].data.map((d: Rec) => d.value)).toEqual([300, 150, 20])
  })

  it('infobulle d\'un secteur : valeur et part formatées', () => {
    const o = construireOptionGraphique(spec({ forme: 'secteurs' }), jeu(PAYS), contexte()).option as Rec
    const html = o.tooltip.formatter({ name: 'Mali', value: 300, percent: 63.8, marker: '' })
    expect(html).toContain('Mali')
    expect(html).toContain(creerFormateur('montant', 'fr')(300))
    expect(html).toContain(creerFormateur('pourcentage', 'fr')(63.8))
  })
})

describe('formats fr / en', () => {
  const params = [{ seriesIndex: 0, seriesName: 'CA', value: 1234.5, axisValueLabel: 'France', marker: '' }]

  it('infobulle fr', () => {
    const o = construireOptionGraphique(spec({ forme: 'barres' }), jeu(PAYS), contexte()).option as Rec
    const html: string = o.tooltip.formatter(params)
    expect(html).toContain(creerFormateur('montant', 'fr')(1234.5))
    expect(html).toContain('€')
  })

  it('infobulle en : séparateurs de la locale', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres' }),
      jeu(PAYS),
      contexte({ locale: 'en' })
    ).option as Rec
    const html: string = o.tooltip.formatter(params)
    expect(html).toContain(creerFormateur('montant', 'en')(1234.5))
    expect(html).toMatch(/1,23[45]/)
    const fr = construireOptionGraphique(spec({ forme: 'barres' }), jeu(PAYS), contexte()).option as Rec
    expect(fr.tooltip.formatter(params)).not.toContain('1,23')
  })

  it('pourcentage en points sur l\'axe et dans l\'infobulle', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'lignes', y: [{ cle: 'taux' }] }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.yAxis.axisLabel.formatter(85)).toBe(
      new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 }).format(0.85)
    )
    expect(o.tooltip.formatter([{ seriesIndex: 0, seriesName: 'T', value: 85, axisValueLabel: 'x' }])).toContain(
      creerFormateur('pourcentage', 'fr')(85)
    )
  })

  it('le format de la spec l\'emporte sur le type de la colonne', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', format: 'entier' }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.series[0].label.formatter({ value: 150 })).toBe(creerFormateur('entier', 'fr')(150))
  })

  it('infobulle triée par valeur décroissante', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', y: [{ cle: 'ca' }, { cle: 'qte', libelle: 'Qté' }] }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    const html: string = o.tooltip.formatter([
      { seriesIndex: 1, seriesName: 'Qté', value: 3, axisValueLabel: 'Mali' },
      { seriesIndex: 0, seriesName: 'CA', value: 300, axisValueLabel: 'Mali' },
    ])
    expect(html.indexOf('CA')).toBeLessThan(html.indexOf('Qté'))
  })
})

describe('combine : axe double', () => {
  const s = spec({
    forme: 'combine',
    x: 'periode',
    y: [{ cle: 'ca', forme: 'barres' }, { cle: 'taux', forme: 'lignes', axe: 'droite' }],
  })

  it('second axe des ordonnées, formats distincts, formes par série', () => {
    const o = construireOptionGraphique(s, jeu(PAYS), contexte()).option as Rec
    expect(o.yAxis).toHaveLength(2)
    expect(o.yAxis[0].axisLabel.formatter(1500)).toContain('€')
    expect(o.yAxis[1].axisLabel.formatter(85)).toContain('%')
    expect(o.yAxis[0].position).toBe('left')
    expect(o.yAxis[1].position).toBe('right')
    expect(o.yAxis[1].splitLine.show).toBe(false)
    expect(o.series[0]).toMatchObject({ type: 'bar', yAxisIndex: 0 })
    expect(o.series[1]).toMatchObject({ type: 'line', yAxisIndex: 1 })
    expect(o.series[1].data).toEqual([50, 80, 40].map(() => expect.any(Number)))
    expect(o.legend.show).toBe(true)
  })

  it('infobulle : chaque série dans son format', () => {
    const o = construireOptionGraphique(s, jeu(PAYS), contexte()).option as Rec
    const html: string = o.tooltip.formatter([
      { seriesIndex: 0, seriesName: 'CA', value: 350, axisValueLabel: 'avr. 2026' },
      { seriesIndex: 1, seriesName: 'Taux', value: 80, axisValueLabel: 'avr. 2026' },
    ])
    expect(html).toContain(creerFormateur('montant', 'fr')(350))
    expect(html).toContain(creerFormateur('pourcentage', 'fr')(80))
  })

  it('le format de la spec ne touche que l\'axe de la première mesure', () => {
    const o = construireOptionGraphique({ ...s, format: 'entier' }, jeu(PAYS), contexte()).option as Rec
    expect(o.yAxis[0].axisLabel.formatter(1500)).not.toContain('€')
    expect(o.yAxis[1].axisLabel.formatter(85)).toContain('%')
  })

  it('forme par défaut : barres à gauche, lignes à droite', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'combine', y: [{ cle: 'ca' }, { cle: 'taux', axe: 'droite' }] }),
      jeu(PAYS),
      contexte()
    ).option as Rec
    expect(o.series.map((x: Rec) => x.type)).toEqual(['bar', 'line'])
  })

  it('RTL : axes de valeur permutés', () => {
    const o = construireOptionGraphique(s, jeu(PAYS), contexte({ rtl: true, locale: 'ar' })).option as Rec
    expect(o.yAxis[0].position).toBe('right')
    expect(o.yAxis[1].position).toBe('left')
  })
})

describe('RTL, compact, statique', () => {
  it('RTL : abscisses inversées, légende à droite, infobulle de droite à gauche', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', y: [{ cle: 'ca' }, { cle: 'qte' }] }),
      jeu(PAYS),
      contexte({ rtl: true, locale: 'ar' })
    ).option as Rec
    expect(o.xAxis.inverse).toBe(true)
    expect(o.legend.left).toBe('right')
    expect(o.yAxis.position).toBe('right')
    expect(o.tooltip.extraCssText).toContain('direction: rtl')
  })

  it('LTR : rien d\'inversé', () => {
    const o = construireOptionGraphique(spec({ forme: 'barres' }), jeu(PAYS), contexte()).option as Rec
    expect(o.xAxis.inverse).toBe(false)
    expect(o.yAxis.position).toBe('left')
    expect(o.tooltip.extraCssText).not.toContain('rtl')
  })

  it('RTL barres horizontales : axe de valeur inversé, libellés à droite', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres_horizontales' }),
      jeu(PAYS),
      contexte({ rtl: true })
    ).option as Rec
    expect(o.xAxis.inverse).toBe(true)
    expect(o.yAxis.position).toBe('right')
  })

  it('compact : légende en bas, police 11, pas de zoom', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', y: [{ cle: 'ca' }, { cle: 'qte' }] }),
      jeu(nPays(30)),
      contexte({ compact: true })
    ).option as Rec
    expect(o.legend.bottom).toBe(0)
    expect(o.legend.top).toBeUndefined()
    expect(o.textStyle.fontSize).toBe(11)
    expect(o.dataZoom).toBeUndefined()
  })

  it('zoom discret au-delà de 24 catégories, sauf compact et statique', () => {
    const lignes = nPays(30)
    const avec = construireOptionGraphique(spec({ forme: 'barres' }), jeu(lignes), contexte()).option as Rec
    expect(avec.dataZoom[0].type).toBe('slider')
    const stat = construireOptionGraphique(
      spec({ forme: 'barres' }),
      jeu(lignes),
      contexte({ statique: true })
    ).option as Rec
    expect(stat.dataZoom).toBeUndefined()
    const peu = construireOptionGraphique(spec({ forme: 'barres' }), jeu(nPays(24)), contexte()).option as Rec
    expect(peu.dataZoom).toBeUndefined()
  })

  it('statique : animation et infobulle désactivées', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres' }),
      jeu(PAYS),
      contexte({ statique: true })
    ).option as Rec
    expect(o.animation).toBe(false)
    expect(o.tooltip.show).toBe(false)
    expect(o.toolbox).toBeUndefined()
    const dyn = construireOptionGraphique(spec({ forme: 'barres' }), jeu(PAYS), contexte()).option as Rec
    expect(dyn.animation).toBe(true)
    expect(dyn.tooltip.show).toBe(true)
  })

  it('axes avec hideOverlap, police de la charte, aucun dégradé', () => {
    const o = construireOptionGraphique(spec({ forme: 'aires', serie: 'canal' }), jeu(PAYS), contexte()).option as Rec
    expect(o.xAxis.axisLabel.hideOverlap).toBe(false) // peu de catégories : toutes affichées
    expect(o.yAxis.axisLabel.hideOverlap).toBe(true)
    expect(o.textStyle.fontFamily).toMatch(/^Public Sans/)
    expect(JSON.stringify(o)).not.toMatch(/LinearGradient|gradient/i)
    expect(o.series[0].areaStyle.opacity).toBeLessThan(0.5)
  })

  it('couleurs de série issues de la palette et du thème', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', serie: 'canal' }),
      jeu(PAYS),
      contexte({ theme: 'sombre' })
    ).option as Rec
    expect(o.color).toEqual(couleursSeries(2, 'sombre'))
    expect(o.textStyle.color).toBe(jetons('sombre').encre)
  })

  it('titre accessible et description via traduire', () => {
    const o = construireOptionGraphique(spec({ forme: 'barres' }), jeu(PAYS), contexte()).option as Rec
    expect(o.title[0].show).toBe(false)
    expect(o.title[0].text).toBe("Graphique en barres : Chiffre d'affaires")
    expect(o.aria.label.description).toMatch(/^1 /)
  })
})

describe('jauge', () => {
  it('pourcentage : échelle 0-100, zones 70 / 90, pointeur selon le seuil', () => {
    const o = construireOptionGraphique(
      { forme: 'jauge', x: 'pays', y: [{ cle: 'taux' }] },
      jeu([{ pays: 'X', taux: 85 }]),
      contexte()
    ).option as Rec
    const g = o.series[0]
    expect(g.type).toBe('gauge')
    expect([g.min, g.max]).toEqual([0, 100])
    expect(g.axisLine.lineStyle.color.map((z: [number, string]) => z[0])).toEqual([0.7, 0.9, 1])
    expect(g.axisLine.lineStyle.color.map((z: [number, string]) => z[1])).toEqual([
      '#b82d1e',
      '#e19909',
      '#1f6f3a',
    ])
    expect(g.pointer.itemStyle.color).toBe('#e19909')
    expect(g.data[0].value).toBe(85)
    expect(g.data[0].name).toContain('Objectif')
    expect(g.detail.formatter(85)).toBe(creerFormateur('pourcentage', 'fr')(85))
  })

  it('autres types : 0 à 1,25 × valeur, total du jeu prioritaire', () => {
    const o = construireOptionGraphique(
      { forme: 'jauge', x: 'pays', y: [{ cle: 'ca' }] },
      jeu([{ pays: 'X', ca: 10 }], { ca: 800 }),
      contexte()
    ).option as Rec
    expect(o.series[0].max).toBe(1000)
    expect(o.series[0].data[0].value).toBe(800)
    expect(o.series[0].pointer.itemStyle.color).toBe('#0f4ca9')
  })

  it('valeur absente : vide', () => {
    const r = construireOptionGraphique(
      { forme: 'jauge', x: 'pays', y: [{ cle: 'ca' }] },
      jeu([{ pays: 'X', ca: null }]),
      contexte()
    )
    expect(r.vide).toBe(true)
  })
})

describe('carte de chaleur', () => {
  const lignes = [
    { periode: '2026-04', pays: 'France', ca: 10 },
    { periode: '2026-04', pays: 'Mali', ca: 30 },
    { periode: '2026-05', pays: 'France', ca: 20 },
  ]

  it('x en abscisse, serie en ordonnée, visualMap monochrome', () => {
    const r = construireOptionGraphique(
      { forme: 'carte_chaleur', x: 'periode', serie: 'pays', y: [{ cle: 'ca' }] },
      jeu(lignes),
      contexte()
    )
    const o = r.option as Rec
    expect(o.series[0].type).toBe('heatmap')
    expect(o.xAxis.data).toHaveLength(2)
    expect(o.yAxis.data).toEqual(['France', 'Mali'])
    expect(o.series[0].data.map((d: Rec) => d.value)).toEqual([
      [0, 0, 10],
      [0, 1, 30],
      [1, 0, 20],
    ])
    expect(o.visualMap.inRange.color).toEqual(jetons('clair').rampe)
    expect(o.visualMap.min).toBe(10)
    expect(o.visualMap.max).toBe(30)
    expect(o.series[0].label.show).toBe(true)
    expect(o.series[0].data[1].label.color).toBe('#ffffff')
    expect(o.series[0].data[0].label.color).toBe(jetons('clair').encre)
  })

  it('pas d\'étiquettes au-delà de 100 cellules', () => {
    const grand = Array.from({ length: 101 }, (_, i) => ({
      pays: `P${i}`,
      canal: 'A',
      ca: i + 1,
    }))
    const o = construireOptionGraphique(
      { forme: 'carte_chaleur', x: 'pays', serie: 'canal', y: [{ cle: 'ca' }] },
      jeu(grand),
      contexte()
    ).option as Rec
    expect(o.series[0].label.show).toBe(false)
  })

  it('infobulle formatée', () => {
    const o = construireOptionGraphique(
      { forme: 'carte_chaleur', x: 'periode', serie: 'pays', y: [{ cle: 'ca' }] },
      jeu(lignes),
      contexte()
    ).option as Rec
    const html = o.tooltip.formatter({ value: [0, 1, 30] })
    expect(html).toContain('Mali')
    expect(html).toContain(creerFormateur('montant', 'fr')(30))
  })
})

describe('nuage de points', () => {
  const lignes = [
    { pays: 'France', qte: 1, ca: 100, canal: 'A' },
    { pays: 'Mali', qte: 3, ca: 300, canal: 'B' },
    { pays: 'Togo', qte: 5, ca: 20, canal: 'A' },
    { pays: 'Bénin', qte: 'x', ca: 20, canal: 'A' },
  ]

  it('x = mesure en abscisse, y en ordonnée, serie colore', () => {
    const o = construireOptionGraphique(
      { forme: 'nuage', x: 'qte', y: [{ cle: 'ca' }], serie: 'canal' },
      jeu(lignes),
      contexte()
    ).option as Rec
    expect(o.series.map((s: Rec) => s.name)).toEqual(['A', 'B'])
    expect(o.series[0].data).toEqual([[1, 100], [5, 20]])
    expect(o.series[0].type).toBe('scatter')
    expect(o.xAxis.type).toBe('value')
    expect(o.yAxis.axisLabel.formatter(1500)).toContain('€')
    expect(o.legend.show).toBe(true)
    expect(o.tooltip.formatter({ seriesName: 'A', value: [1, 100] })).toContain(
      creerFormateur('montant', 'fr')(100)
    )
  })

  it('sans point numérique : vide', () => {
    const r = construireOptionGraphique(
      { forme: 'nuage', x: 'pays', y: [{ cle: 'ca' }] },
      jeu(lignes),
      contexte()
    )
    expect(r.vide).toBe(true)
  })
})

describe('sécurité', () => {
  const piege = '<img src=x onerror=alert(1)>'

  it('echapperHtml', () => {
    expect(echapperHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
    expect(echapperHtml(null)).toBe('')
  })

  it('infobulle d\'axe : libellés de données échappés', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres', serie: 'canal' }),
      jeu([{ pays: piege, canal: piege, ca: 5 }]),
      contexte()
    ).option as Rec
    const html: string = o.tooltip.formatter([
      { seriesIndex: 0, seriesName: piege, value: 5, axisValueLabel: piege, marker: '' },
    ])
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    // les noms restent des chaînes brutes dans l'option (rendues en texte canvas)
    expect(typeof o.xAxis.data[0]).toBe('string')
  })

  it.each(['secteurs', 'treemap', 'entonnoir'] as const)('infobulle %s échappée', forme => {
    const o = construireOptionGraphique(
      spec({ forme }),
      jeu([{ pays: piege, ca: 5 }]),
      contexte()
    ).option as Rec
    const html: string = o.tooltip.formatter({ name: piege, value: 5, percent: 100 })
    expect(html).not.toContain('<img')
  })

  it('infobulles de carte de chaleur et de nuage échappées', () => {
    const c = construireOptionGraphique(
      { forme: 'carte_chaleur', x: 'pays', serie: 'canal', y: [{ cle: 'ca' }] },
      jeu([{ pays: piege, canal: piege, ca: 5 }]),
      contexte()
    ).option as Rec
    expect(c.tooltip.formatter({ value: [0, 0, 5] })).not.toContain('<img')
    const n = construireOptionGraphique(
      { forme: 'nuage', x: 'qte', y: [{ cle: 'ca' }], serie: 'canal' },
      jeu([{ qte: 1, canal: piege, ca: 5 }]),
      contexte()
    ).option as Rec
    expect(n.tooltip.formatter({ seriesName: piege, value: [1, 5] })).not.toContain('<img')
  })
})

describe('déterminisme et traductions', () => {
  it('même entrée, même option (hors fonctions)', () => {
    const s = spec({ forme: 'barres_empilees', serie: 'canal', limite: 2 })
    const a = JSON.stringify(construireOptionGraphique(s, jeu(PAYS), contexte()).option)
    const b = JSON.stringify(construireOptionGraphique(s, jeu(PAYS), contexte()).option)
    expect(a).toBe(b)
  })

  it('n\'altère ni la spec ni le jeu', () => {
    const s = spec({ forme: 'barres', limite: 1, y: [{ cle: 'ca' }, { cle: 'qte' }] })
    const j = jeu(PAYS)
    const avant = JSON.stringify([s, j])
    construireOptionGraphique(s, j, contexte())
    expect(JSON.stringify([s, j])).toBe(avant)
  })

  it('toutes les clés demandées à traduire existent dans le JSON', () => {
    const cles = new Set<string>()
    const ctx = contexte({}, cles)
    for (const forme of [
      'barres', 'barres_empilees', 'barres_horizontales', 'lignes', 'aires', 'secteurs', 'anneau',
      'treemap', 'entonnoir', 'jauge', 'combine', 'carte_chaleur', 'nuage',
    ] as const) {
      construireOptionGraphique(
        { forme, x: 'pays', y: [{ cle: 'ca' }], limite: 1, serie: forme === 'carte_chaleur' ? 'canal' : undefined },
        jeu([...PAYS, { pays: null, ca: 1, canal: null, qte: 2 }]),
        ctx
      )
    }
    construireOptionGraphique(spec({ forme: 'barres' }), jeu([]), ctx)
    expect(cles.size).toBeGreaterThan(8)
    for (const c of cles) expect(chercher(c), c).toBeTypeOf('string')
  })

  it('catégorie nulle : libellé « Non renseigné »', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres' }),
      jeu([{ pays: null, ca: 5 }]),
      contexte()
    ).option as Rec
    expect(o.xAxis.data).toEqual(['Non renseigné'])
  })
})

describe('recette visuelle du panneau étroit', () => {
  const SIX = ['Mirambie', 'Kovanie', 'Zanduria', 'Talvera', 'Ostrel', 'Peronia'].map((pays, i) => ({
    pays,
    ca: 227504 - i * 1000,
    taux: 50,
    qte: i,
    periode: '2026-04',
    canal: 'A',
  }))

  it('barres : les 6 catégories restent affichées (interval 0, retour à la ligne)', () => {
    const o = construireOptionGraphique(spec({ forme: 'barres' }), jeu(SIX), contexte()).option as Rec
    expect(o.xAxis.axisLabel.interval).toBe(0)
    expect(o.xAxis.axisLabel.hideOverlap).toBe(false)
    expect(o.xAxis.axisLabel.overflow).toBe('break')
    expect(o.xAxis.axisLabel.width).toBeGreaterThan(0)
  })

  it('au-delà de 12 catégories, ECharts peut masquer les chevauchements', () => {
    const beaucoup = Array.from({ length: 13 }, (_, i) => ({ ...SIX[0], pays: `Pays ${i}` }))
    const o = construireOptionGraphique(spec({ forme: 'barres' }), jeu(beaucoup), contexte()).option as Rec
    expect(o.xAxis.axisLabel.interval).toBeUndefined()
    expect(o.xAxis.axisLabel.hideOverlap).toBe(true)
  })

  it('barres horizontales : marge droite réservée aux étiquettes de valeur', () => {
    const o = construireOptionGraphique(spec({ forme: 'barres_horizontales' }), jeu(SIX), contexte()).option as Rec
    expect(o.grid.containLabel).toBe(true)
    expect(o.grid.right).toBeGreaterThanOrEqual(72)
    expect(o.yAxis.axisLabel.interval).toBe(0)
  })

  it('barres horizontales en RTL : la marge est réservée à gauche', () => {
    const o = construireOptionGraphique(
      spec({ forme: 'barres_horizontales' }),
      jeu(SIX),
      contexte({ rtl: true })
    ).option as Rec
    expect(o.grid.left).toBeGreaterThanOrEqual(72)
    expect(o.grid.right).toBeLessThan(72)
  })

  it('secteurs : étiquette en pourcentage seul, sans nom tronqué', () => {
    const o = construireOptionGraphique(spec({ forme: 'secteurs' }), jeu(SIX), contexte()).option as Rec
    const texte = o.series[0].label.formatter({ name: 'Mirambie', percent: 24.5 }) as string
    expect(texte).not.toContain('Mirambie')
    expect(texte).toMatch(/24/)
    expect(o.legend.show).not.toBe(false)
  })
})
