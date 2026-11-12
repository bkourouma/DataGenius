import { describe, expect, it } from 'vitest'

import type { ColonneJeu } from '@/lib/medic-assist/contrats'
import { calculerPivot } from '@/lib/medic-assist/artefacts/pivot'

const COLONNES: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'produit', libelle: 'Produit', type: 'texte' },
  { cle: 'periode', libelle: 'Période', type: 'periode' },
  { cle: 'ca_eur', libelle: 'CA', type: 'montant' },
  { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
  { cle: 'qte', libelle: 'Quantité', type: 'entier' },
]

const LIGNES = [
  { pays: 'Mali', produit: 'A', periode: '2026-04', ca_eur: 100, taux: 80, qte: 10 },
  { pays: 'Mali', produit: 'B', periode: '2026-04', ca_eur: 300, taux: 100, qte: 30 },
  { pays: 'Mali', produit: 'A', periode: '2026-10', ca_eur: 50, taux: 50, qte: 5 },
  { pays: 'Ghana', produit: 'A', periode: '2026-04', ca_eur: 200, taux: 90, qte: 20 },
  { pays: 'Ghana', produit: 'B', periode: '2026-10', ca_eur: null, taux: null, qte: null },
]

const base = { locale: 'fr', totaux: false }

describe('calculerPivot', () => {
  it('somme par pays, une colonne par période, périodes chronologiques', () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      base
    )
    expect(m.estPivot).toBe(true)
    expect(m.colonnes.map(c => c.type)).toEqual(['dimension', 'valeur', 'valeur'])
    expect(m.colonnes[1].id).toBe('v0|2026-04|ca_eur|somme')
    expect(m.colonnes[2].id).toBe('v0|2026-10|ca_eur|somme')
    expect(m.colonnes[1].entete).toHaveLength(2)
    expect(m.colonnes[1].entete?.[1]).toBe('CA')
    expect(m.colonnes[1].libelle).toBe(m.colonnes[1].entete?.join(' · '))
    // Pays au collator : Ghana avant Mali.
    expect(m.lignes.map(l => l.pays)).toEqual(['Ghana', 'Mali'])
    expect(m.lignes[0]['v0|2026-04|ca_eur|somme']).toBe(200)
    expect(m.lignes[1]['v0|2026-04|ca_eur|somme']).toBe(400)
    expect(m.lignes[1]['v0|2026-10|ca_eur|somme']).toBe(50)
    expect(m.totaux).toBeNull()
  })

  it('met la période octobre après avril même si octobre arrive en premier', () => {
    const lignes = [
      { pays: 'X', periode: '2026-10', ca_eur: 1 },
      { pays: 'X', periode: '2026-04', ca_eur: 2 },
      { pays: 'X', periode: '2027-01', ca_eur: 3 },
    ]
    const m = calculerPivot(
      lignes,
      COLONNES,
      { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      base
    )
    expect(m.colonnes.slice(1).map(c => c.id.split('|')[1])).toEqual([
      '2026-04',
      '2026-10',
      '2027-01',
    ])
  })

  it("formate l'en-tête des périodes lisiblement", () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      base
    )
    expect(m.colonnes[1].entete?.[0]).toMatch(/avr/i)
    expect(m.colonnes[1].entete?.[0]).toContain('2026')
  })

  it('cellule sans ligne = null, pas 0', () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      base
    )
    // Ghana n'a que du null en octobre : aucune valeur numérique -> null.
    expect(m.lignes[0]['v0|2026-10|ca_eur|somme']).toBeNull()
    const m2 = calculerPivot(
      [
        { pays: 'A', periode: '2026-04', ca_eur: 1 },
        { pays: 'B', periode: '2026-05', ca_eur: 2 },
      ],
      COLONNES,
      { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      base
    )
    expect(m2.lignes[0]['v0|2026-05|ca_eur|somme']).toBeNull()
  })

  it('moyenne, min, max et nombre', () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      {
        lignes: ['pays'],
        colonnes: [],
        valeurs: [
          { cle: 'ca_eur', agregat: 'moyenne' },
          { cle: 'ca_eur', agregat: 'min' },
          { cle: 'ca_eur', agregat: 'max' },
          { cle: 'ca_eur', agregat: 'nombre' },
        ],
      },
      base
    )
    const mali = m.lignes.find(l => l.pays === 'Mali')!
    const ids = m.colonnes.filter(c => c.type === 'valeur').map(c => c.id)
    expect(mali[ids[0]]).toBeCloseTo(150)
    expect(mali[ids[1]]).toBe(50)
    expect(mali[ids[2]]).toBe(300)
    expect(mali[ids[3]]).toBe(3)
    const ghana = m.lignes.find(l => l.pays === 'Ghana')!
    expect(ghana[ids[3]]).toBe(1) // la ligne null n'est pas comptée
    expect(m.colonnes.find(c => c.id === ids[3])?.format).toBe('entier')
    // Même mesure, plusieurs agrégats : le libellé d'agrégat est ajouté.
    expect(m.colonnes.find(c => c.id === ids[1])?.libelle).toContain('min')
  })

  it("ignore les cellules non numériques pour la somme", () => {
    const m = calculerPivot(
      [
        { pays: 'A', ca_eur: 'abc' },
        { pays: 'A', ca_eur: '12' },
        { pays: 'A', ca_eur: true },
      ],
      COLONNES,
      { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      base
    )
    expect(m.lignes[0][m.colonnes[1].id]).toBe(12)
  })

  it("utilise libelleAgregat quand l'agrégat n'est pas la somme", () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca_eur', agregat: 'moyenne' }] },
      { ...base, libelleAgregat: a => `<${a}>` }
    )
    expect(m.colonnes[1].libelle).toBe('CA (<moyenne>)')
    const somme = calculerPivot(
      LIGNES,
      COLONNES,
      { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      { ...base, libelleAgregat: a => `<${a}>` }
    )
    expect(somme.colonnes[1].libelle).toBe('CA')
  })

  it('totaux : colonne total par mesure et ligne de totaux', () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      { ...base, totaux: true }
    )
    const total = m.colonnes.find(c => c.type === 'total')!
    expect(total).toBeDefined()
    const mali = m.lignes.find(l => l.pays === 'Mali')!
    expect(mali[total.id]).toBe(450)
    expect(m.totaux?.[total.id]).toBe(650)
    expect(m.totaux?.['v0|2026-04|ca_eur|somme']).toBe(600)
    expect(m.totaux?.['v0|2026-10|ca_eur|somme']).toBe(50)
    expect(m.lignes).toHaveLength(2) // les totaux ne sont pas dans lignes
  })

  it('moyenne pondérée dans les totaux (pas moyenne de moyennes)', () => {
    const lignes = [
      { pays: 'A', periode: '2026-04', ca_eur: 10 },
      { pays: 'A', periode: '2026-04', ca_eur: 20 },
      { pays: 'A', periode: '2026-04', ca_eur: 30 },
      { pays: 'A', periode: '2026-05', ca_eur: 100 },
    ]
    const m = calculerPivot(
      lignes,
      COLONNES,
      { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca_eur', agregat: 'moyenne' }] },
      { ...base, totaux: true }
    )
    const total = m.colonnes.find(c => c.type === 'total')!
    // (10+20+30+100)/4 = 40 ; la moyenne des moyennes (20 et 100) donnerait 60.
    expect(m.lignes[0][total.id]).toBe(40)
    expect(m.totaux?.[total.id]).toBe(40)
  })

  it('total de min, max et nombre sur les lignes source', () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      {
        lignes: ['pays'],
        colonnes: ['periode'],
        valeurs: [
          { cle: 'ca_eur', agregat: 'min' },
          { cle: 'ca_eur', agregat: 'max' },
          { cle: 'ca_eur', agregat: 'nombre' },
        ],
      },
      { ...base, totaux: true }
    )
    const totaux = m.colonnes.filter(c => c.type === 'total')
    expect(totaux).toHaveLength(3)
    expect(m.totaux?.[totaux[0].id]).toBe(50)
    expect(m.totaux?.[totaux[1].id]).toBe(300)
    expect(m.totaux?.[totaux[2].id]).toBe(4)
  })

  it('pas de total pour un pourcentage agrégé en somme', () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'taux', agregat: 'somme' }] },
      { ...base, totaux: true }
    )
    const total = m.colonnes.find(c => c.type === 'total')!
    expect(m.totaux?.[total.id]).toBeNull()
    expect(m.lignes[0][total.id]).toBeNull()
    expect(m.totaux?.['v0|2026-04|taux|somme']).toBeNull()
    // La moyenne d'un pourcentage a un sens.
    const moy = calculerPivot(
      LIGNES,
      COLONNES,
      { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'taux', agregat: 'moyenne' }] },
      { ...base, totaux: true }
    )
    const t = moy.colonnes.find(c => c.type === 'total')!
    expect(moy.totaux?.[t.id]).toBeCloseTo(80)
  })

  it('sans dimension en colonnes : une colonne par mesure et pas de colonne total', () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      {
        lignes: ['pays'],
        colonnes: [],
        valeurs: [
          { cle: 'ca_eur', agregat: 'somme' },
          { cle: 'qte', agregat: 'somme' },
        ],
      },
      { ...base, totaux: true }
    )
    expect(m.colonnes.map(c => c.type)).toEqual(['dimension', 'valeur', 'valeur'])
    expect(m.totaux?.[m.colonnes[1].id]).toBe(650)
    expect(m.totaux?.[m.colonnes[2].id]).toBe(65)
  })

  it('deux dimensions en lignes et en colonnes', () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      {
        lignes: ['pays', 'produit'],
        colonnes: ['periode'],
        valeurs: [{ cle: 'qte', agregat: 'somme' }],
      },
      base
    )
    expect(m.lignes.map(l => `${l.pays}/${l.produit}`)).toEqual([
      'Ghana/A',
      'Ghana/B',
      'Mali/A',
      'Mali/B',
    ])
    expect(m.colonnes[0].id).toBe('pays')
    expect(m.colonnes[1].id).toBe('produit')
  })

  it('ids de colonne sans collision malgré des valeurs avec séparateur', () => {
    const lignes = [
      { pays: 'a|b', ca_eur: 1 },
      { pays: 'a', ca_eur: 2 },
      { pays: 'b', ca_eur: 3 },
    ]
    const m = calculerPivot(
      lignes,
      COLONNES,
      { lignes: [], colonnes: ['pays'], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      base
    )
    const ids = m.colonnes.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('clés inconnues ignorées sans exception', () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      {
        lignes: ['pays', 'zzz'],
        colonnes: ['yyy'],
        valeurs: [
          { cle: 'ca_eur', agregat: 'somme' },
          { cle: 'inconnue', agregat: 'somme' },
        ],
      },
      { ...base, totaux: true }
    )
    expect(m.colonnes.filter(c => c.type === 'valeur')).toHaveLength(1)
    expect(m.lignes).toHaveLength(2)
  })

  it('jeu vide : pas de ligne, colonnes de mesure présentes sans dimension en colonnes', () => {
    const m = calculerPivot(
      [],
      COLONNES,
      { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      { ...base, totaux: true }
    )
    expect(m.lignes).toEqual([])
    expect(m.colonnes).toHaveLength(2)
    expect(m.totaux?.[m.colonnes[1].id]).toBeNull()
    expect(m.nbLignesSource).toBe(0)
    const m2 = calculerPivot(
      [],
      COLONNES,
      { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      base
    )
    expect(m2.colonnes).toHaveLength(1)
  })

  it('une seule ligne', () => {
    const m = calculerPivot(
      [LIGNES[0]],
      COLONNES,
      { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      { ...base, totaux: true }
    )
    expect(m.lignes).toHaveLength(1)
    expect(m.nbLignesFiltrees).toBe(1)
  })

  it('sans dimension en lignes : une ligne unique', () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      { lignes: [], colonnes: ['pays'], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      base
    )
    expect(m.lignes).toHaveLength(1)
  })

  it('valeur de dimension null regroupée et placée en dernier', () => {
    const m = calculerPivot(
      [
        { pays: null, ca_eur: 5 },
        { pays: 'Mali', ca_eur: 1 },
      ],
      COLONNES,
      { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      base
    )
    expect(m.lignes.map(l => l.pays)).toEqual(['Mali', null])
  })

  it('locales ar et hi sans exception', () => {
    for (const locale of ['ar', 'hi']) {
      const m = calculerPivot(
        LIGNES,
        COLONNES,
        { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
        { locale, totaux: true }
      )
      expect(m.lignes).toHaveLength(2)
      expect(m.colonnes[1].entete?.[0]).toBeTruthy()
    }
  })

  it('format imposé par colonne', () => {
    const m = calculerPivot(
      LIGNES,
      COLONNES,
      { lignes: ['pays'], colonnes: [], valeurs: [{ cle: 'ca_eur', agregat: 'somme' }] },
      { ...base, formats: { ca_eur: 'montant_compact' } }
    )
    expect(m.colonnes[1].format).toBe('montant_compact')
  })

  it('ne mute pas les entrées', () => {
    const copie = JSON.parse(JSON.stringify(LIGNES))
    const pivot = {
      lignes: ['pays'],
      colonnes: ['periode'],
      valeurs: [{ cle: 'ca_eur', agregat: 'somme' as const }],
    }
    const pivotCopie = JSON.parse(JSON.stringify(pivot))
    calculerPivot(LIGNES, COLONNES, pivot, { ...base, totaux: true })
    expect(LIGNES).toEqual(copie)
    expect(pivot).toEqual(pivotCopie)
  })

  it('10 000 lignes en moins de 500 ms', () => {
    const pays = Array.from({ length: 40 }, (_, i) => `Pays ${i}`)
    const gros = Array.from({ length: 10_000 }, (_, i) => ({
      pays: pays[i % 40],
      produit: `P${i % 25}`,
      periode: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
      ca_eur: i,
      taux: i % 100,
      qte: i % 7,
    }))
    const debut = performance.now()
    const m = calculerPivot(
      gros,
      COLONNES,
      {
        lignes: ['pays', 'produit'],
        colonnes: ['periode'],
        valeurs: [
          { cle: 'ca_eur', agregat: 'somme' },
          { cle: 'taux', agregat: 'moyenne' },
        ],
      },
      { ...base, totaux: true }
    )
    const duree = performance.now() - debut
    expect(duree).toBeLessThan(500)
    expect(m.nbLignesSource).toBe(10_000)
    expect(m.totaux).not.toBeNull()
  })
})
