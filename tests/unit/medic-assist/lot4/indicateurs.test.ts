import { describe, expect, it } from 'vitest'

import type {
  CarteIndicateur,
  ColonneJeu,
} from '@/lib/medic-assist/contrats'
import { resoudreIndicateurs, statutObjectif } from '@/lib/medic-assist/artefacts/indicateurs'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'
import { SEUIL_TAUX_ATTEINT } from '@/lib/reports/seuils-objectifs'

const colonnes: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'ca', libelle: 'CA', type: 'montant' },
  { cle: 'budget', libelle: 'Budget', type: 'montant' },
  { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
]

function jeu(
  id: string,
  lignes: Record<string, unknown>[],
  totaux?: Record<string, number>
): JeuClient {
  return {
    jeuDeDonneesId: id,
    colonnes,
    lignes,
    nbLignes: lignes.length,
    tronque: false,
    totaux,
    provenance: {
      source: 'semantique',
      libelleSource: 'test',
      perimetre: { pays: 'tous', libelle: 'Tous' },
      filtres: [],
      regles: [],
      calculeA: '2026-11-02T00:00:00.000Z',
    },
  }
}

const J = jeu(
  'j1',
  [
    { pays: 'Mali', ca: 1200, budget: 1000, taux: 120 },
    { pays: 'Ghana', ca: 800, budget: 1000, taux: 80 },
  ],
  { ca: 2000, budget: 2000 }
)

const carte = (partiel: Partial<CarteIndicateur> & Pick<CarteIndicateur, 'source'>) =>
  ({ libelle: 'Carte', ...partiel }) as CarteIndicateur

describe('resoudreIndicateurs : sources', () => {
  it('ligne absente : total de la colonne, sinon l’unique ligne, sinon pas de valeur (jamais la première ligne d’un jeu multi-lignes, B-1)', () => {
    const r = resoudreIndicateurs(
      [
        carte({ source: { jeuDeDonneesId: 'j1', colonne: 'ca' } }),
        carte({ source: { jeuDeDonneesId: 'j1', colonne: 'taux' } }),
      ],
      { j1: J },
      'fr'
    )
    expect(r[0].valeur).toBe(2000)
    expect(r[1].valeur).toBeNull()
  })

  it('ligne absente, jeu d’une seule ligne sans total : cette ligne', () => {
    const r = resoudreIndicateurs(
      [carte({ source: { jeuDeDonneesId: 'j1', colonne: 'taux' } })],
      { j1: { ...J, lignes: [J.lignes[0]], nbLignes: 1, totaux: undefined } },
      'fr'
    )
    expect(r[0].valeur).toBe(120)
  })

  it('ligne par rang', () => {
    const r = resoudreIndicateurs(
      [carte({ source: { jeuDeDonneesId: 'j1', colonne: 'ca', ligne: 1 } })],
      { j1: J },
      'fr'
    )
    expect(r[0].valeur).toBe(800)
  })

  it('rang hors limites, négatif : null', () => {
    const r = resoudreIndicateurs(
      [
        carte({ source: { jeuDeDonneesId: 'j1', colonne: 'ca', ligne: 9 } }),
        carte({ source: { jeuDeDonneesId: 'j1', colonne: 'ca', ligne: -1 } }),
      ],
      { j1: J },
      'fr'
    )
    expect(r.map(x => x.valeur)).toEqual([null, null])
  })

  it('ligne {cle, valeur} tolérante à la casse', () => {
    const r = resoudreIndicateurs(
      [carte({ source: { jeuDeDonneesId: 'j1', colonne: 'ca', ligne: { cle: 'pays', valeur: 'GHANA' } } })],
      { j1: J },
      'fr'
    )
    expect(r[0].valeur).toBe(800)
  })

  it('valeur {cle, valeur} numérique comparée en chaîne', () => {
    const jn = jeu('jn', [{ pays: 2026, ca: 5, budget: 0, taux: 0 }])
    const r = resoudreIndicateurs(
      [carte({ source: { jeuDeDonneesId: 'jn', colonne: 'ca', ligne: { cle: 'pays', valeur: '2026' } } })],
      { jn },
      'fr'
    )
    expect(r[0].valeur).toBe(5)
  })

  it('jeu absent, colonne inconnue, ligne introuvable, jeu vide : null et pas de crash', () => {
    const vide = jeu('v', [])
    const r = resoudreIndicateurs(
      [
        carte({ source: { jeuDeDonneesId: 'absent', colonne: 'ca' } }),
        carte({ source: { jeuDeDonneesId: 'j1', colonne: 'zzz' } }),
        carte({ source: { jeuDeDonneesId: 'j1', colonne: 'ca', ligne: { cle: 'pays', valeur: 'Chine' } } }),
        carte({ source: { jeuDeDonneesId: 'v', colonne: 'ca' } }),
      ],
      { j1: J, v: vide },
      'fr'
    )
    for (const x of r) {
      expect(x.valeur).toBeNull()
      expect(x.valeurFormatee).toBe('')
    }
  })

  it('valeur non numérique ou null : null', () => {
    const j = jeu('t', [{ pays: 'Mali', ca: null, budget: 'abc', taux: 1 }])
    const r = resoudreIndicateurs(
      [
        carte({ source: { jeuDeDonneesId: 't', colonne: 'ca' } }),
        carte({ source: { jeuDeDonneesId: 't', colonne: 'budget' } }),
        carte({ source: { jeuDeDonneesId: 't', colonne: 'pays' } }),
      ],
      { t: j },
      'fr'
    )
    expect(r.map(x => x.valeur)).toEqual([null, null, null])
  })
})

describe('resoudreIndicateurs : formats', () => {
  it('format de la colonne, EUR et pourcentage en points', () => {
    const r = resoudreIndicateurs(
      [
        carte({ source: { jeuDeDonneesId: 'j1', colonne: 'ca', ligne: 0 } }),
        carte({ source: { jeuDeDonneesId: 'j1', colonne: 'taux', ligne: 0 } }),
      ],
      { j1: J },
      'fr'
    )
    expect(r[0].format).toBe('montant')
    expect(r[0].valeurFormatee).toMatch(/1\s?200/)
    expect(r[0].valeurFormatee).toContain('€')
    expect(r[1].format).toBe('pourcentage')
    expect(r[1].valeurFormatee).toMatch(/120/)
    expect(r[1].valeurFormatee).toContain('%')
  })

  it('format de la carte prioritaire', () => {
    const r = resoudreIndicateurs(
      [carte({ source: { jeuDeDonneesId: 'j1', colonne: 'ca', ligne: 0 }, format: 'montant_compact' })],
      { j1: J },
      'fr'
    )
    expect(r[0].format).toBe('montant_compact')
  })

  it('locales ar et hi sans exception', () => {
    for (const locale of ['ar', 'hi']) {
      const r = resoudreIndicateurs(
        [
          carte({
            source: { jeuDeDonneesId: 'j1', colonne: 'ca', ligne: 0 },
            comparaison: { source: { jeuDeDonneesId: 'j1', colonne: 'ca', ligne: 1 }, libelle: 'N-1' },
          }),
        ],
        { j1: J },
        locale
      )
      expect(r[0].valeurFormatee).not.toBe('')
      expect(r[0].comparaison?.valeurFormatee).not.toBe('')
    }
  })
})

describe('resoudreIndicateurs : comparaison', () => {
  const avecRef = (ref: number | null) => {
    const j = jeu('c', [{ pays: 'A', ca: 120, budget: ref, taux: 0 }])
    return resoudreIndicateurs(
      [
        carte({
          source: { jeuDeDonneesId: 'c', colonne: 'ca', ligne: 0 },
          comparaison: { source: { jeuDeDonneesId: 'c', colonne: 'budget', ligne: 0 }, libelle: 'Réf' },
        }),
      ],
      { c: j },
      'fr'
    )[0].comparaison!
  }

  it('hausse', () => {
    const c = avecRef(100)
    expect(c.variationPct).toBeCloseTo(20)
    expect(c.sens).toBe('hausse')
    expect(c.libelle).toBe('Réf')
  })

  it('baisse, avec référence négative (|référence|)', () => {
    const j = jeu('c', [{ pays: 'A', ca: -150, budget: -100, taux: 0 }])
    const c = resoudreIndicateurs(
      [
        carte({
          source: { jeuDeDonneesId: 'c', colonne: 'ca', ligne: 0 },
          comparaison: { source: { jeuDeDonneesId: 'c', colonne: 'budget', ligne: 0 }, libelle: 'r' },
        }),
      ],
      { c: j },
      'fr'
    )[0].comparaison!
    expect(c.variationPct).toBeCloseTo(-50)
    expect(c.sens).toBe('baisse')
  })

  it('stable sous 0,05 point', () => {
    const j = jeu('c', [{ pays: 'A', ca: 100.04, budget: 100, taux: 0 }])
    const c = resoudreIndicateurs(
      [
        carte({
          source: { jeuDeDonneesId: 'c', colonne: 'ca', ligne: 0 },
          comparaison: { source: { jeuDeDonneesId: 'c', colonne: 'budget', ligne: 0 }, libelle: 'r' },
        }),
      ],
      { c: j },
      'fr'
    )[0].comparaison!
    expect(c.sens).toBe('stable')
  })

  it('référence nulle ou absente : variation et sens null', () => {
    for (const ref of [0, null]) {
      const c = avecRef(ref)
      expect(c.variationPct).toBeNull()
      expect(c.sens).toBeNull()
    }
  })
})

describe('statut des objectifs', () => {
  const statut = (valeur: number, objectif: number) => {
    const j = jeu('o', [{ pays: 'A', ca: valeur, budget: objectif, taux: 0 }])
    return resoudreIndicateurs(
      [
        carte({
          source: { jeuDeDonneesId: 'o', colonne: 'ca', ligne: 0 },
          objectif: { source: { jeuDeDonneesId: 'o', colonne: 'budget', ligne: 0 } },
        }),
      ],
      { o: j },
      'fr'
    )[0].objectif!
  }

  it('reprend le seuil du reste de application (90)', () => {
    expect(SEUIL_TAUX_ATTEINT).toBe(90)
  })

  it('bornes 89,99 / 90 / 99,99 / 100', () => {
    expect(statut(89.99, 100).statut).toBe('a_risque')
    expect(statut(90, 100).statut).toBe('en_cours')
    expect(statut(99.99, 100).statut).toBe('en_cours')
    expect(statut(100, 100).statut).toBe('atteint')
    expect(statut(150, 100).statut).toBe('atteint')
    expect(statut(0, 100).statut).toBe('a_risque')
  })

  it('taux en points', () => {
    expect(statut(85, 100).taux).toBeCloseTo(85)
    expect(statut(200, 100).taux).toBeCloseTo(200)
  })

  it('objectif nul ou absent : taux et statut null', () => {
    expect(statut(10, 0)).toMatchObject({ taux: null, statut: null })
    const j = jeu('o', [{ pays: 'A', ca: 10, budget: null, taux: 0 }])
    const o = resoudreIndicateurs(
      [
        carte({
          source: { jeuDeDonneesId: 'o', colonne: 'ca', ligne: 0 },
          objectif: { source: { jeuDeDonneesId: 'o', colonne: 'budget', ligne: 0 }, libelle: 'Obj' },
        }),
      ],
      { o: j },
      'fr'
    )[0].objectif!
    expect(o).toMatchObject({ taux: null, statut: null, valeur: null, libelle: 'Obj' })
  })

  it('valeur nulle : statut null', () => {
    const j = jeu('o', [{ pays: 'A', ca: null, budget: 100, taux: 0 }])
    const o = resoudreIndicateurs(
      [
        carte({
          source: { jeuDeDonneesId: 'o', colonne: 'ca', ligne: 0 },
          objectif: { source: { jeuDeDonneesId: 'o', colonne: 'budget', ligne: 0 } },
        }),
      ],
      { o: j },
      'fr'
    )[0].objectif!
    expect(o.statut).toBeNull()
  })

  it('statutObjectif direct', () => {
    expect(statutObjectif(90, 100)).toBe('en_cours')
    expect(statutObjectif(100, 100)).toBe('atteint')
    expect(statutObjectif(1, 0)).toBe('a_risque')
  })
})

describe('resoudreIndicateurs : cas généraux', () => {
  it('liste vide', () => {
    expect(resoudreIndicateurs([], {}, 'fr')).toEqual([])
  })
  it('conserve le libellé de la carte', () => {
    const r = resoudreIndicateurs(
      [carte({ libelle: 'Mon CA', source: { jeuDeDonneesId: 'j1', colonne: 'ca' } })],
      { j1: J },
      'fr'
    )
    expect(r[0].libelle).toBe('Mon CA')
    expect(r[0].comparaison).toBeUndefined()
    expect(r[0].objectif).toBeUndefined()
  })
})

