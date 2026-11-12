import { describe, expect, it } from 'vitest'

import { construireModeleTableau } from '@/lib/medic-assist/artefacts/modele-tableau'
import { modeleVersTsv } from '@/lib/medic-assist/artefacts/tsv'

import type { ColonneJeu } from '@/lib/medic-assist/contrats'
import type { JeuClient, ModeleTableau } from '@/lib/medic-assist/artefacts/types-rendu'

const colonnes: ColonneJeu[] = [
  { cle: 'pays', libelle: 'Pays', type: 'texte' },
  { cle: 'periode', libelle: 'Période', type: 'periode' },
  { cle: 'ca', libelle: 'CA', type: 'montant' },
  { cle: 'taux', libelle: 'Taux', type: 'pourcentage' },
]

function jeu(lignes: Record<string, unknown>[]): JeuClient {
  return {
    jeuDeDonneesId: 'j1',
    colonnes,
    lignes,
    nbLignes: lignes.length,
    tronque: false,
    provenance: {
      source: 'semantique',
      libelleSource: 'Ventes',
      perimetre: { pays: 'tous', libelle: 'Tous les pays' },
      filtres: [],
      regles: [],
      calculeA: '2026-11-02T00:00:00Z',
    },
  }
}

const lignes = [
  { pays: 'Mali', periode: '2026-04', ca: 1234.5, taux: 80 },
  { pays: 'Ghana', periode: '2026-05', ca: 50, taux: 12.5 },
]

describe('modeleVersTsv', () => {
  it('formate les valeurs comme à l’écran (fr)', () => {
    const modele = construireModeleTableau(jeu(lignes), { titre: 'T', jeuDeDonneesId: 'j1' }, { locale: 'fr' })
    const tsv = modeleVersTsv(modele, { locale: 'fr', libelleTotal: 'Total' })
    const l = tsv.split('\n')
    expect(l[0]).toBe('Pays\tPériode\tCA\tTaux')
    const cellules = l[2].split('\t')
    expect(cellules[0]).toBe('Mali')
    expect(cellules[2]).toMatch(/^1\s?235\s€$/)
    expect(cellules[3]).toMatch(/^80,0\s%$/)
    expect(l).toHaveLength(3)
  })

  it('suit la langue (en)', () => {
    const modele = construireModeleTableau(jeu(lignes), { titre: 'T', jeuDeDonneesId: 'j1' }, { locale: 'en' })
    const tsv = modeleVersTsv(modele, { locale: 'en', libelleTotal: 'Total' })
    const cellules = tsv.split('\n')[2].split('\t')
    expect(cellules[2]).toBe('€1,235')
    expect(cellules[3]).toBe('80.0%')
  })

  it('ajoute la ligne de totaux avec son libellé dans la première colonne', () => {
    const modele = construireModeleTableau(
      jeu(lignes),
      { titre: 'T', jeuDeDonneesId: 'j1', totaux: true },
      { locale: 'fr' }
    )
    const dernier = modeleVersTsv(modele, { locale: 'fr', libelleTotal: 'Total' }).split('\n').pop()!
    const cellules = dernier.split('\t')
    expect(cellules[0]).toBe('Total')
    expect(cellules[1]).toBe('')
    expect(cellules[2]).toMatch(/^1\s?285\s?€$|^1\s?284,50\s?€$|€/)
    // un pourcentage n'est jamais additionné
    expect(cellules[3]).toBe('')
  })

  it('remplace tabulations et retours à la ligne par des espaces', () => {
    const modele = construireModeleTableau(
      jeu([{ pays: 'Ma\tli\nsud\r\nest', periode: '2026-04', ca: 1, taux: 1 }]),
      { titre: 'T', jeuDeDonneesId: 'j1' },
      { locale: 'fr' }
    )
    const tsv = modeleVersTsv(modele, { locale: 'fr', libelleTotal: 'Total' })
    const ligne = tsv.split('\n')[1]
    expect(ligne.split('\t')).toHaveLength(4)
    expect(ligne.split('\t')[0]).toBe('Ma li sud est')
  })

  it('écrit une ligne d’en-tête par niveau pour un pivot', () => {
    const modele = construireModeleTableau(
      jeu([
        { pays: 'Mali', periode: '2026-04', ca: 100, taux: 1 },
        { pays: 'Mali', periode: '2026-05', ca: 200, taux: 1 },
        { pays: 'Ghana', periode: '2026-04', ca: 50, taux: 1 },
      ]),
      {
        titre: 'T',
        jeuDeDonneesId: 'j1',
        totaux: true,
        pivot: { lignes: ['pays'], colonnes: ['periode'], valeurs: [{ cle: 'ca', agregat: 'somme' }] },
      },
      { locale: 'fr' }
    )
    expect(modele.estPivot).toBe(true)
    const tsv = modeleVersTsv(modele, { locale: 'fr', libelleTotal: 'Total' })
    const l = tsv.split('\n')
    // deux niveaux d'en-tête : période, puis mesure ; « Pays » sur la dernière ligne d'en-tête
    expect(l[0].split('\t')[0]).toBe('')
    expect(l[1].split('\t')[0]).toBe('Pays')
    expect(l[1]).toContain('CA')
    expect(l[0].split('\t').length).toBe(l[1].split('\t').length)
    expect(l[l.length - 1].split('\t')[0]).toBe('Total')
  })

  it('un modèle sans colonne donne un texte vide', () => {
    const vide: ModeleTableau = {
      colonnes: [],
      lignes: [],
      totaux: null,
      estPivot: false,
      nbLignesSource: 0,
      nbLignesFiltrees: 0,
    }
    expect(modeleVersTsv(vide, { locale: 'fr', libelleTotal: 'Total' })).toBe('')
  })
})
