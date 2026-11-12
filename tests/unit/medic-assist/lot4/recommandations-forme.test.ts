import { describe, expect, it } from 'vitest'

import {
  FORMES_GRAPHIQUE,
  FORMES_UNE_MESURE,
  type ColonneJeu,
  type GraphiqueSpec,
} from '@/lib/medic-assist/contrats'
import {
  MAX_CATEGORIES_SECTEURS,
  appliquerChangementForme,
  compterCategories,
  evaluerForme,
  formesProposees,
} from '@/lib/medic-assist/artefacts/recommandations-forme'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

const colonnes: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'produit', libelle: 'Produit', type: 'texte' },
  { cle: 'periode', libelle: 'Période', type: 'periode' },
  { cle: 'ca', libelle: 'CA', type: 'montant' },
  { cle: 'qte', libelle: 'Quantité', type: 'entier' },
  { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
]

function jeuAvec(nbPays: number, cols: ColonneJeu[] = colonnes): JeuClient {
  const lignes = Array.from({ length: nbPays }, (_, i) => ({
    pays: `Pays ${i}`,
    produit: i % 2 ? 'A' : 'B',
    periode: `2026-0${(i % 9) + 1}`,
    ca: 100 + i,
    qte: i,
    taux: 50,
  }))
  return {
    jeuDeDonneesId: 'j',
    colonnes: cols,
    lignes,
    nbLignes: lignes.length,
    tronque: false,
    provenance: {
      source: 'semantique',
      libelleSource: 't',
      perimetre: { pays: 'tous', libelle: 'Tous' },
      filtres: [],
      regles: [],
      calculeA: '2026-11-02T00:00:00.000Z',
    },
  }
}

const barres = (partiel: Partial<GraphiqueSpec> = {}): GraphiqueSpec => ({
  forme: 'barres',
  x: 'pays',
  y: [{ cle: 'ca' }],
  ...partiel,
})

/** Les règles du superRefine de GraphiqueSpecSchema (lot 0). */
function valide(g: GraphiqueSpec): boolean {
  if (FORMES_UNE_MESURE.includes(g.forme) && g.y.length !== 1) return false
  if (g.forme === 'combine' && g.y.length < 2) return false
  if (g.forme === 'carte_chaleur' && !g.serie) return false
  return g.y.length >= 1 && g.y.length <= 12
}

describe('compterCategories', () => {
  it('valeurs distinctes non vides de x', () => {
    expect(compterCategories(barres(), jeuAvec(5))).toBe(5)
    expect(compterCategories(barres({ x: 'produit' }), jeuAvec(5))).toBe(2)
  })
  it('jeu vide, colonne inconnue, valeurs null', () => {
    expect(compterCategories(barres(), jeuAvec(0))).toBe(0)
    expect(compterCategories(barres({ x: 'zzz' }), jeuAvec(3))).toBe(0)
    const j = jeuAvec(0)
    j.lignes = [{ pays: null }, { pays: '' }, { pays: 'A' }, { pays: 'A' }]
    expect(compterCategories(barres(), j)).toBe(1)
  })
})

describe('evaluerForme', () => {
  it('ok pour barres', () => {
    expect(evaluerForme(barres(), jeuAvec(5))).toEqual({ ok: true, formeRecommandee: 'barres' })
  })

  it('secteurs : 8 catégories passent, 9 non', () => {
    expect(MAX_CATEGORIES_SECTEURS).toBe(8)
    expect(evaluerForme(barres({ forme: 'secteurs' }), jeuAvec(8)).ok).toBe(true)
    const r = evaluerForme(barres({ forme: 'secteurs' }), jeuAvec(9))
    expect(r).toMatchObject({
      ok: false,
      motif: 'trop_de_categories',
      formeRecommandee: 'barres_horizontales',
    })
  })

  it('secteurs avec plusieurs mesures : une_mesure_requise', () => {
    const r = evaluerForme(barres({ forme: 'secteurs', y: [{ cle: 'ca' }, { cle: 'qte' }] }), jeuAvec(5))
    expect(r.motif).toBe('une_mesure_requise')
    expect(r.ok).toBe(false)
  })

  it('une seule catégorie pour secteurs : categories_insuffisantes', () => {
    expect(evaluerForme(barres({ forme: 'anneau' }), jeuAvec(1)).motif).toBe('categories_insuffisantes')
    expect(evaluerForme(barres({ forme: 'secteurs' }), jeuAvec(0)).motif).toBe('categories_insuffisantes')
  })

  it('combine avec une série : deux_mesures_requises', () => {
    expect(evaluerForme(barres({ forme: 'combine' }), jeuAvec(5)).motif).toBe('deux_mesures_requises')
    expect(
      evaluerForme(barres({ forme: 'combine', y: [{ cle: 'ca' }, { cle: 'taux' }] }), jeuAvec(5)).ok
    ).toBe(true)
  })

  it('carte_chaleur sans serie : serie_requise', () => {
    expect(evaluerForme(barres({ forme: 'carte_chaleur' }), jeuAvec(5)).motif).toBe('serie_requise')
    expect(evaluerForme(barres({ forme: 'carte_chaleur', serie: 'produit' }), jeuAvec(5)).ok).toBe(true)
  })

  it('recommande lignes pour un axe temporel', () => {
    const r = evaluerForme(barres({ forme: 'combine', x: 'periode' }), jeuAvec(5))
    expect(r.formeRecommandee).toBe('lignes')
  })

  it('nuage sans deux mesures', () => {
    const peu = jeuAvec(5, colonnes.slice(0, 4))
    expect(evaluerForme(barres({ forme: 'nuage', x: 'ca' }), peu).motif).toBe('deux_mesures_requises')
    expect(evaluerForme(barres({ forme: 'nuage', x: 'ca', y: [{ cle: 'qte' }] }), jeuAvec(5)).ok).toBe(true)
  })

  it('jeu vide ne lève pas', () => {
    expect(() => evaluerForme(barres(), jeuAvec(0))).not.toThrow()
  })
})

describe('formesProposees', () => {
  it('rend les 13 formes dans l’ordre du contrat', () => {
    const r = formesProposees(barres(), jeuAvec(5))
    expect(r.map(f => f.forme)).toEqual([...FORMES_GRAPHIQUE])
    expect(r).toHaveLength(13)
  })

  it('trop de catégories : secteurs, anneau, entonnoir, jauge indisponibles ; treemap non', () => {
    const r = Object.fromEntries(formesProposees(barres(), jeuAvec(20)).map(f => [f.forme, f]))
    for (const f of ['secteurs', 'anneau', 'entonnoir', 'jauge']) {
      expect(r[f]).toMatchObject({ disponible: false, motif: 'trop_de_categories' })
    }
    expect(r.treemap.disponible).toBe(true)
    expect(r.barres.disponible).toBe(true)
  })

  it('combine et carte_chaleur selon la spécification, nuage selon le jeu', () => {
    const un = Object.fromEntries(formesProposees(barres(), jeuAvec(5)).map(f => [f.forme, f]))
    expect(un.combine).toMatchObject({ disponible: false, motif: 'deux_mesures_requises' })
    expect(un.carte_chaleur).toMatchObject({ disponible: false, motif: 'serie_requise' })
    expect(un.nuage.disponible).toBe(true)

    const deux = Object.fromEntries(
      formesProposees(barres({ y: [{ cle: 'ca' }, { cle: 'taux' }], serie: 'produit' }), jeuAvec(5)).map(
        f => [f.forme, f]
      )
    )
    expect(deux.combine.disponible).toBe(true)
    expect(deux.carte_chaleur.disponible).toBe(true)

    const une = Object.fromEntries(
      formesProposees(barres(), jeuAvec(5, colonnes.slice(0, 4))).map(f => [f.forme, f])
    )
    expect(une.nuage).toMatchObject({ disponible: false, motif: 'deux_mesures_requises' })
  })

  it('jeu vide : formes à parts indisponibles, sans exception', () => {
    const r = formesProposees(barres(), jeuAvec(0))
    expect(r.find(f => f.forme === 'secteurs')?.disponible).toBe(false)
    expect(r.find(f => f.forme === 'barres')?.disponible).toBe(true)
  })
})

describe('appliquerChangementForme', () => {
  it('même forme : copie identique', () => {
    const spec = barres()
    const r = appliquerChangementForme(spec, 'barres', jeuAvec(5))
    expect(r.spec).toEqual(spec)
    expect(r.spec).not.toBe(spec)
    expect(r.formeEffective).toBe('barres')
    expect(r.motif).toBeUndefined()
  })

  it('ne modifie jamais l’entrée', () => {
    const spec = barres({ y: [{ cle: 'ca', forme: 'barres' }, { cle: 'qte' }], empile: true })
    const copie = JSON.parse(JSON.stringify(spec))
    for (const f of FORMES_GRAPHIQUE) appliquerChangementForme(spec, f, jeuAvec(5))
    expect(spec).toEqual(copie)
  })

  it('vers une forme à une mesure : première série seulement, empile retiré', () => {
    const spec = barres({ y: [{ cle: 'ca' }, { cle: 'qte' }], empile: true })
    const r = appliquerChangementForme(spec, 'secteurs', jeuAvec(5))
    expect(r.formeEffective).toBe('secteurs')
    expect(r.spec.y).toEqual([{ cle: 'ca' }])
    expect(r.spec.empile).toBeUndefined()
    expect(valide(r.spec)).toBe(true)
  })

  it('secteurs ou anneau avec plus de 8 catégories : refusé, barres horizontales', () => {
    for (const f of ['secteurs', 'anneau'] as const) {
      const r = appliquerChangementForme(barres(), f, jeuAvec(9))
      expect(r.formeEffective).toBe('barres_horizontales')
      expect(r.spec.forme).toBe('barres_horizontales')
      expect(r.motif).toBe('trop_de_categories')
      expect(valide(r.spec)).toBe(true)
    }
    expect(appliquerChangementForme(barres(), 'secteurs', jeuAvec(8)).formeEffective).toBe('secteurs')
  })

  it('barres empilées : empile true ; en sortir le retire', () => {
    const r = appliquerChangementForme(barres({ y: [{ cle: 'ca' }, { cle: 'qte' }] }), 'barres_empilees', jeuAvec(5))
    expect(r.spec.empile).toBe(true)
    const retour = appliquerChangementForme(r.spec, 'barres', jeuAvec(5))
    expect(retour.spec.empile).toBeUndefined()
    const aires = appliquerChangementForme(r.spec, 'aires', jeuAvec(5))
    expect(aires.spec.empile).toBe(true)
    expect(appliquerChangementForme(barres({ empile: true }), 'aires', jeuAvec(5)).spec.empile).toBe(true)
  })

  it('combine avec une seule mesure : refusé, forme inchangée', () => {
    const spec = barres()
    const r = appliquerChangementForme(spec, 'combine', jeuAvec(5))
    expect(r.formeEffective).toBe('barres')
    expect(r.motif).toBe('deux_mesures_requises')
    expect(r.spec).toEqual(spec)
  })

  it('combine avec deux mesures : barres puis lignes ; en sortir retire les formes de série', () => {
    const r = appliquerChangementForme(barres({ y: [{ cle: 'ca' }, { cle: 'taux' }] }), 'combine', jeuAvec(5))
    expect(r.spec.y.map(s => s.forme)).toEqual(['barres', 'lignes'])
    expect(valide(r.spec)).toBe(true)
    const sortie = appliquerChangementForme(r.spec, 'lignes', jeuAvec(5))
    expect(sortie.spec.y.every(s => s.forme === undefined)).toBe(true)
    const un = appliquerChangementForme(r.spec, 'secteurs', jeuAvec(5))
    expect(un.spec.y).toEqual([{ cle: 'ca' }])
  })

  it('combine conserve les formes de série déjà choisies', () => {
    const r = appliquerChangementForme(
      barres({ y: [{ cle: 'ca', forme: 'lignes' }, { cle: 'taux', forme: 'barres' }] }),
      'combine',
      jeuAvec(5)
    )
    expect(r.spec.y.map(s => s.forme)).toEqual(['lignes', 'barres'])
  })

  it('carte_chaleur sans serie : refusé ; avec serie : accepté', () => {
    const r = appliquerChangementForme(barres(), 'carte_chaleur', jeuAvec(5))
    expect(r.motif).toBe('serie_requise')
    expect(r.formeEffective).toBe('barres')
    const ok = appliquerChangementForme(barres({ serie: 'produit', y: [{ cle: 'ca' }, { cle: 'qte' }] }), 'carte_chaleur', jeuAvec(5))
    expect(ok.formeEffective).toBe('carte_chaleur')
    expect(ok.spec.y).toHaveLength(1)
    expect(valide(ok.spec)).toBe(true)
  })

  it('une catégorie : secteurs refusé (categories_insuffisantes)', () => {
    const r = appliquerChangementForme(barres(), 'secteurs', jeuAvec(1))
    expect(r.motif).toBe('categories_insuffisantes')
    expect(r.formeEffective).toBe('barres')
  })

  it('vers le nuage : deux mesures, jamais de série en trop', () => {
    const r = appliquerChangementForme(barres({ y: [{ cle: 'ca' }, { cle: 'qte' }] }), 'nuage', jeuAvec(5))
    expect(r.formeEffective).toBe('nuage')
    expect(r.spec.x).toBe('ca')
    expect(r.spec.y).toEqual([{ cle: 'qte' }])
    const seule = appliquerChangementForme(barres(), 'nuage', jeuAvec(5))
    expect(seule.spec.x).toBe('ca')
    expect(seule.spec.y[0].cle).not.toBe('ca')
    expect(valide(seule.spec)).toBe(true)
    expect(appliquerChangementForme(barres(), 'nuage', jeuAvec(5, colonnes.slice(0, 4))).motif).toBe(
      'deux_mesures_requises'
    )
  })

  it('depuis le nuage : x redevient une dimension', () => {
    const nuage = barres({ forme: 'nuage', x: 'ca', y: [{ cle: 'qte' }] })
    const r = appliquerChangementForme(nuage, 'barres', jeuAvec(5))
    expect(r.spec.x).toBe('pays')
    expect(r.spec.y.map(s => s.cle)).toEqual(['ca', 'qte'])
    const t = appliquerChangementForme(nuage, 'lignes', jeuAvec(5))
    expect(t.spec.x).toBe('periode')
    const s = appliquerChangementForme(nuage, 'secteurs', jeuAvec(5))
    expect(s.spec.y).toEqual([{ cle: 'ca' }])
    expect(valide(s.spec)).toBe(true)
    const sansDim = jeuAvec(5, colonnes.filter(c => c.type === 'montant' || c.type === 'entier'))
    expect(appliquerChangementForme(nuage, 'barres', sansDim).formeEffective).toBe('nuage')
  })

  it('toujours une spécification valide, toutes formes confondues', () => {
    const specs = [
      barres(),
      barres({ y: [{ cle: 'ca' }, { cle: 'qte' }, { cle: 'taux' }], empile: true }),
      barres({ forme: 'combine', y: [{ cle: 'ca', forme: 'barres' }, { cle: 'taux', forme: 'lignes', axe: 'droite' }] }),
      barres({ forme: 'carte_chaleur', serie: 'produit' }),
      barres({ forme: 'nuage', x: 'ca', y: [{ cle: 'qte' }] }),
    ]
    for (const nb of [0, 1, 5, 12]) {
      for (const spec of specs) {
        for (const f of FORMES_GRAPHIQUE) {
          const r = appliquerChangementForme(spec, f, jeuAvec(nb))
          expect(valide(r.spec), `${spec.forme} -> ${f} (${nb})`).toBe(true)
          expect(r.spec.forme).toBe(r.formeEffective)
        }
      }
    }
  })

  it('conserve les autres champs (limite, tri, format, serie)', () => {
    const r = appliquerChangementForme(
      barres({ limite: 5, trierPar: 'ca', sens: 'asc', format: 'montant', serie: 'produit' }),
      'lignes',
      jeuAvec(5)
    )
    expect(r.spec).toMatchObject({ limite: 5, trierPar: 'ca', sens: 'asc', format: 'montant', serie: 'produit' })
  })
})
