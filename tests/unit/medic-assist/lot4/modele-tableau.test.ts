import { describe, expect, it } from 'vitest'

import type {
  ColonneJeu,
  ContenuTableau,
  FiltreArtefact,
} from '@/lib/medic-assist/contrats'
import { construireModeleTableau } from '@/lib/medic-assist/artefacts/modele-tableau'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

const colonnes: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'periode', libelle: 'Période', type: 'periode' },
  { cle: 'jour', libelle: 'Jour', type: 'date' },
  { cle: 'ca', libelle: 'CA', type: 'montant' },
  { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
  { cle: 'qte', libelle: 'Quantité', type: 'entier', unite: 'boîtes' },
]

const lignes = [
  { pays: 'Côte d’Ivoire', periode: '2026-04', jour: '2026-04-05', ca: 100, taux: 80, qte: 10 },
  { pays: 'Mali', periode: '2026-05', jour: '2026-05-01', ca: 300, taux: 100, qte: 30 },
  { pays: 'Ghana', periode: '2026-10', jour: '2026-10-15', ca: 50, taux: 50, qte: 5 },
  { pays: 'mali', periode: '2026-10', jour: '2026-10-20', ca: null, taux: null, qte: null },
  { pays: 'Pays 10', periode: '2026-04', jour: '2026-04-30', ca: 200, taux: 90, qte: 2 },
  { pays: 'Pays 2', periode: '2026-04', jour: '2026-04-01', ca: 20, taux: 10, qte: 1 },
]

function jeu(partiel: Partial<JeuClient> = {}): JeuClient {
  return {
    jeuDeDonneesId: 'j',
    colonnes,
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
    ...partiel,
  }
}

const spec = (partiel: Partial<ContenuTableau> = {}): ContenuTableau => ({
  titre: 'T',
  jeuDeDonneesId: 'j',
  ...partiel,
})

const opts = { locale: 'fr' }

const filtrer = (...filtres: FiltreArtefact[]) =>
  construireModeleTableau(jeu(), spec({ filtres }), opts).lignes.map(l => l.pays)

describe('colonnes', () => {
  it('toutes les colonnes du jeu sans spec.colonnes', () => {
    const m = construireModeleTableau(jeu(), spec(), opts)
    expect(m.colonnes.map(c => c.id)).toEqual(colonnes.map(c => c.cle))
    expect(m.estPivot).toBe(false)
    expect(m.nbLignesSource).toBe(6)
    expect(m.nbLignesFiltrees).toBe(6)
  })

  it('ordre, libellé, format et visibilité de la spec', () => {
    const m = construireModeleTableau(
      jeu(),
      spec({
        colonnes: [
          { cle: 'ca', libelle: 'Chiffre', format: 'montant_compact' },
          { cle: 'pays' },
          { cle: 'taux', visible: false },
          { cle: 'inconnue' },
        ],
      }),
      opts
    )
    expect(m.colonnes.map(c => c.id)).toEqual(['ca', 'pays'])
    expect(m.colonnes[0]).toMatchObject({
      libelle: 'Chiffre',
      format: 'montant_compact',
      type: 'valeur',
      alignement: 'end',
    })
    expect(m.colonnes[1]).toMatchObject({
      libelle: 'Pays',
      format: 'texte',
      type: 'dimension',
      alignement: 'start',
    })
    expect(Object.keys(m.lignes[0])).toEqual(['ca', 'pays'])
  })

  it('alignement et type selon le format', () => {
    const m = construireModeleTableau(jeu(), spec(), opts)
    const par = Object.fromEntries(m.colonnes.map(c => [c.id, c]))
    expect(par.periode).toMatchObject({ type: 'dimension', alignement: 'start' })
    expect(par.jour).toMatchObject({ type: 'dimension', alignement: 'start' })
    expect(par.taux).toMatchObject({ type: 'valeur', alignement: 'end' })
    expect(par.qte.unite).toBe('boîtes')
  })

  it('un format texte imposé sur un nombre le rend dimension', () => {
    const m = construireModeleTableau(
      jeu(),
      spec({ colonnes: [{ cle: 'qte', format: 'texte' }] }),
      opts
    )
    expect(m.colonnes[0]).toMatchObject({ type: 'dimension', alignement: 'start' })
  })
})

describe('filtres', () => {
  it('egal et different (nombres)', () => {
    expect(filtrer({ cle: 'ca', operateur: 'egal', valeur: 300 })).toEqual(['Mali'])
    expect(filtrer({ cle: 'ca', operateur: 'egal', valeur: '300' })).toEqual(['Mali'])
    // different garde la cellule null
    expect(filtrer({ cle: 'ca', operateur: 'different', valeur: 300 })).toHaveLength(5)
  })

  it('egal et different (texte, exact)', () => {
    expect(filtrer({ cle: 'pays', operateur: 'egal', valeur: 'Mali' })).toEqual(['Mali'])
    expect(filtrer({ cle: 'pays', operateur: 'different', valeur: 'Mali' })).toHaveLength(5)
  })

  it('contient insensible à la casse et aux accents', () => {
    expect(filtrer({ cle: 'pays', operateur: 'contient', valeur: 'cote' })).toEqual([
      'Côte d’Ivoire',
    ])
    expect(filtrer({ cle: 'pays', operateur: 'contient', valeur: 'MALI' })).toEqual([
      'Mali',
      'mali',
    ])
  })

  it('comparaisons numériques', () => {
    expect(filtrer({ cle: 'ca', operateur: 'superieur', valeur: 100 })).toEqual(['Mali', 'Pays 10'])
    expect(filtrer({ cle: 'ca', operateur: 'superieur_ou_egal', valeur: 100 })).toHaveLength(3)
    expect(filtrer({ cle: 'ca', operateur: 'inferieur', valeur: 50 })).toEqual(['Pays 2'])
    expect(filtrer({ cle: 'ca', operateur: 'inferieur_ou_egal', valeur: 50 })).toHaveLength(2)
  })

  it('comparaison numérique et non lexicale (10 > 9)', () => {
    const j = jeu({
      lignes: [
        { pays: 'a', ca: 10 },
        { pays: 'b', ca: 9 },
      ],
    })
    const m = construireModeleTableau(
      j,
      spec({ filtres: [{ cle: 'ca', operateur: 'superieur', valeur: 9 }] }),
      opts
    )
    expect(m.lignes.map(l => l.pays)).toEqual(['a'])
  })

  it('parmi', () => {
    expect(filtrer({ cle: 'pays', operateur: 'parmi', valeur: ['Mali', 'Ghana'] })).toEqual([
      'Ghana',
      'Mali',
    ])
    expect(filtrer({ cle: 'qte', operateur: 'parmi', valeur: [10, 30] })).toHaveLength(2)
    expect(filtrer({ cle: 'qte', operateur: 'parmi', valeur: [] })).toEqual([])
  })

  it('entre, bornes incluses', () => {
    expect(filtrer({ cle: 'ca', operateur: 'entre', valeur: [100, 200] })).toEqual([
      'Côte d’Ivoire',
      'Pays 10',
    ])
  })

  it('dates et périodes comparées comme chaînes', () => {
    expect(
      filtrer({ cle: 'jour', operateur: 'entre', valeur: ['2026-05-01', '2026-10-15'] })
    ).toEqual(['Ghana', 'Mali'])
    expect(filtrer({ cle: 'periode', operateur: 'superieur_ou_egal', valeur: '2026-10' })).toEqual([
      'Ghana',
      'mali',
    ])
    expect(filtrer({ cle: 'periode', operateur: 'egal', valeur: '2026-05' })).toEqual(['Mali'])
  })

  it('une cellule null ne satisfait aucun filtre sauf different', () => {
    for (const operateur of [
      'egal',
      'superieur',
      'superieur_ou_egal',
      'inferieur',
      'inferieur_ou_egal',
    ] as const) {
      expect(
        construireModeleTableau(jeu(), spec({ filtres: [{ cle: 'ca', operateur, valeur: 0 }] }), opts)
          .lignes.map(l => l.ca)
          .includes(null)
      ).toBe(false)
    }
    expect(
      filtrer({ cle: 'ca', operateur: 'entre', valeur: [-1e9, 1e9] }).includes('mali')
    ).toBe(false)
    expect(filtrer({ cle: 'ca', operateur: 'parmi', valeur: [0] })).toEqual([])
    expect(filtrer({ cle: 'ca', operateur: 'contient', valeur: '' }).includes('mali')).toBe(false)
    expect(filtrer({ cle: 'ca', operateur: 'different', valeur: 0 }).includes('mali')).toBe(true)
  })

  it('filtres combinés en ET', () => {
    expect(
      filtrer(
        { cle: 'periode', operateur: 'egal', valeur: '2026-04' },
        { cle: 'ca', operateur: 'superieur', valeur: 50 }
      )
    ).toEqual(['Côte d’Ivoire', 'Pays 10'])
  })

  it('clé inconnue ou filtre mal formé ignorés', () => {
    expect(filtrer({ cle: 'zzz', operateur: 'egal', valeur: 1 })).toHaveLength(6)
    expect(filtrer({ cle: 'ca', operateur: 'entre', valeur: 5 })).toHaveLength(6)
  })

  it('compte les lignes source et filtrées', () => {
    const m = construireModeleTableau(
      jeu(),
      spec({ filtres: [{ cle: 'pays', operateur: 'egal', valeur: 'Mali' }] }),
      opts
    )
    expect(m.nbLignesSource).toBe(6)
    expect(m.nbLignesFiltrees).toBe(1)
  })
})

describe('tri', () => {
  const tri = (t: ContenuTableau['tri']) =>
    construireModeleTableau(jeu(), spec({ tri: t }), opts).lignes

  it('sans spec.tri : dimensions de gauche à droite, A-Z sans accent ni casse, nombres naturels', () => {
    const l = construireModeleTableau(jeu(), spec(), opts).lignes
    expect(l.map(x => x.pays)).toEqual([
      'Côte d’Ivoire',
      'Ghana',
      'Mali',
      'mali',
      'Pays 2',
      'Pays 10',
    ])
  })

  it('sans spec.tri : une période ou une date se trie chronologiquement après la dimension texte', () => {
    const l = construireModeleTableau(
      jeu(),
      spec({
        colonnes: [{ cle: 'periode' }, { cle: 'pays' }, { cle: 'ca' }],
      }),
      opts
    ).lignes
    expect(l.map(x => `${x.periode}|${x.pays}`)).toEqual([
      '2026-04|Côte d’Ivoire',
      '2026-04|Pays 2',
      '2026-04|Pays 10',
      '2026-05|Mali',
      '2026-10|Ghana',
      '2026-10|mali',
    ])
  })

  it.each(['ar', 'zh', 'hi', 'en', 'es'])('sans spec.tri : locale %s sans exception', locale => {
    const l = construireModeleTableau(jeu(), spec(), { locale }).lignes
    expect(l).toHaveLength(lignes.length)
    expect(l.map(x => x.pays)).toContain('Ghana')
  })

  it('spec.tri prime sur le tri par défaut', () => {
    const l = tri([{ cle: 'ca', sens: 'desc' }]).map(x => x.pays)
    expect(l[0]).toBe('Mali')
  })

  it('nombres numériquement, null en dernier dans les deux sens', () => {
    expect(tri([{ cle: 'ca', sens: 'asc' }]).map(l => l.ca)).toEqual([20, 50, 100, 200, 300, null])
    expect(tri([{ cle: 'ca', sens: 'desc' }]).map(l => l.ca)).toEqual([300, 200, 100, 50, 20, null])
  })

  it('textes au collator avec chiffres numériques', () => {
    const pays = tri([{ cle: 'pays', sens: 'asc' }]).map(l => l.pays)
    expect(pays.indexOf('Pays 2')).toBeLessThan(pays.indexOf('Pays 10'))
    expect(pays[0]).toBe('Côte d’Ivoire')
  })

  it('multi-clés avec priorité et stabilité', () => {
    const l = tri([
      { cle: 'periode', sens: 'asc' },
      { cle: 'ca', sens: 'desc' },
    ])
    expect(l.map(x => x.pays)).toEqual(['Pays 10', 'Côte d’Ivoire', 'Pays 2', 'Mali', 'Ghana', 'mali'])
    // égalité totale : l'ordre d'origine est conservé (Mali avant mali)
    const egal = tri([{ cle: 'pays', sens: 'asc' }]).map(x => x.pays)
    expect(egal.indexOf('Mali')).toBeLessThan(egal.indexOf('mali'))
  })

  it('clé de tri inconnue ignorée ; entrée non mutée', () => {
    const copie = JSON.parse(JSON.stringify(lignes))
    const m = tri([{ cle: 'zzz', sens: 'asc' }])
    expect(m.map(l => l.pays)).toEqual(lignes.map(l => l.pays))
    tri([{ cle: 'ca', sens: 'desc' }])
    expect(lignes).toEqual(copie)
  })

  it('dates chronologiques', () => {
    const j = tri([{ cle: 'jour', sens: 'asc' }]).map(l => l.jour)
    expect(j).toEqual([...j].sort())
  })

  it('locales ar et hi', () => {
    for (const locale of ['ar', 'hi']) {
      const m = construireModeleTableau(jeu(), spec({ tri: [{ cle: 'pays', sens: 'asc' }] }), {
        locale,
      })
      expect(m.lignes).toHaveLength(6)
    }
  })
})

describe('totaux', () => {
  it('colonnes additives seulement, sur les lignes affichées', () => {
    const m = construireModeleTableau(jeu(), spec({ totaux: true }), opts)
    expect(m.totaux).toMatchObject({ ca: 670, qte: 48, taux: null, pays: null, periode: null, jour: null })
  })

  it('totaux recalculés après filtre, même si le jeu est tronqué', () => {
    const j = jeu({ tronque: true, totaux: { ca: 99999, qte: 99999 } })
    const m = construireModeleTableau(
      j,
      spec({ totaux: true, filtres: [{ cle: 'periode', operateur: 'egal', valeur: '2026-04' }] }),
      opts
    )
    expect(m.totaux).toMatchObject({ ca: 320, qte: 13 })
  })

  it('jeu tronqué sans filtre : totaux serveur', () => {
    const j = jeu({ tronque: true, totaux: { ca: 99999 } })
    const m = construireModeleTableau(j, spec({ totaux: true }), opts)
    expect(m.totaux?.ca).toBe(99999)
    // pas de total serveur pour qte : somme des lignes chargées
    expect(m.totaux?.qte).toBe(48)
  })

  it('jeu non tronqué : somme recalculée, totaux serveur ignorés', () => {
    const j = jeu({ totaux: { ca: 1 } })
    expect(construireModeleTableau(j, spec({ totaux: true }), opts).totaux?.ca).toBe(670)
  })

  it('une colonne cachée ne porte pas de total ; totaux non demandés : null', () => {
    const m = construireModeleTableau(
      jeu(),
      spec({ totaux: true, colonnes: [{ cle: 'ca' }, { cle: 'qte', visible: false }] }),
      opts
    )
    expect(Object.keys(m.totaux!)).toEqual(['ca'])
    expect(construireModeleTableau(jeu(), spec(), opts).totaux).toBeNull()
  })

  it('montant_compact additif ; pourcentage jamais, même forcé', () => {
    const m = construireModeleTableau(
      jeu(),
      spec({
        totaux: true,
        colonnes: [
          { cle: 'ca', format: 'montant_compact' },
          { cle: 'taux', format: 'pourcentage' },
        ],
      }),
      opts
    )
    expect(m.totaux).toEqual({ ca: 670, taux: null })
  })

  it('toutes les cellules null : total null', () => {
    const j = jeu({ lignes: [{ ca: null }, { ca: null }] })
    expect(construireModeleTableau(j, spec({ totaux: true }), opts).totaux?.ca).toBeNull()
  })
})

describe('cas limites', () => {
  it('jeu vide', () => {
    const m = construireModeleTableau(jeu({ lignes: [], nbLignes: 0 }), spec({ totaux: true }), opts)
    expect(m.lignes).toEqual([])
    expect(m.nbLignesSource).toBe(0)
    expect(m.totaux?.ca).toBeNull()
  })

  it('une seule ligne', () => {
    const m = construireModeleTableau(
      jeu({ lignes: [lignes[0]] }),
      spec({ tri: [{ cle: 'ca', sens: 'asc' }], totaux: true }),
      opts
    )
    expect(m.lignes).toHaveLength(1)
    expect(m.totaux?.ca).toBe(100)
  })

  it('cellule manquante dans la ligne : null', () => {
    const m = construireModeleTableau(jeu({ lignes: [{ pays: 'x' }] }), spec(), opts)
    expect(m.lignes[0].ca).toBeNull()
  })
})

describe('pivot', () => {
  it('délègue au pivot après filtre', () => {
    const m = construireModeleTableau(
      jeu(),
      spec({
        filtres: [{ cle: 'periode', operateur: 'egal', valeur: '2026-04' }],
        totaux: true,
        pivot: { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca', agregat: 'somme' }] },
      }),
      opts
    )
    expect(m.estPivot).toBe(true)
    expect(m.nbLignesSource).toBe(6)
    expect(m.nbLignesFiltrees).toBe(3)
    expect(m.lignes).toHaveLength(3)
    expect(m.totaux?.['t|0|ca|somme']).toBe(320)
  })

  it('le format de colonne de la spec est transmis au pivot', () => {
    const m = construireModeleTableau(
      jeu(),
      spec({
        colonnes: [{ cle: 'ca', format: 'montant_compact' }],
        pivot: { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca', agregat: 'somme' }] },
      }),
      opts
    )
    expect(m.colonnes[1].format).toBe('montant_compact')
  })

  it('libelleAgregat transmis', () => {
    const m = construireModeleTableau(
      jeu(),
      spec({ pivot: { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca', agregat: 'max' }] } }),
      { locale: 'fr', libelleAgregat: () => 'Maximum' }
    )
    expect(m.colonnes[1].libelle).toBe('CA (Maximum)')
  })
})
