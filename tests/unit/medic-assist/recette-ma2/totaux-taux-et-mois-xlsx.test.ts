import { describe, expect, it } from 'vitest'

import type { ColonneJeu, ContenuTableau } from '@/lib/medic-assist/contrats'
import { construireXlsx } from '@/lib/medic-assist/artefacts/exports/xlsx'
import { construireModeleTableau } from '@/lib/medic-assist/artefacts/modele-tableau'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

import {
  blocTableau,
  creerPrep,
  lignesDeFeuille,
  lireClasseur,
} from '../lot4/_export-fixtures'

const colonnes: ColonneJeu[] = [
  { cle: 'agence', libelle: 'Agence', type: 'texte' },
  { cle: 'periode', libelle: 'Mois', type: 'periode' },
  { cle: 'budget', libelle: 'Budget', type: 'montant' },
  { cle: 'realise', libelle: 'Réalisé', type: 'montant' },
  { cle: 'taux', libelle: 'Taux de réalisation (%)', type: 'pourcentage' },
]

// Σ réalisé = 950, Σ budget = 1 000 : taux global 95 ; la moyenne des taux (100) serait fausse.
const lignes = [
  { agence: 'A', periode: '2026-04', budget: 100, realise: 100, taux: 100 },
  { agence: 'B', periode: '2026-04', budget: 900, realise: 850, taux: 94.44 },
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
      calculeA: '2026-11-02T08:30:00.000Z',
    } as JeuClient['provenance'],
    ...partiel,
  }
}

const spec = (p: Partial<ContenuTableau> = {}): ContenuTableau =>
  ({ type: 'tableau', jeuDeDonneesId: 'j', totaux: true, ...p }) as ContenuTableau

const opts = { locale: 'fr' }

describe('N-11 : taux de la ligne Total', () => {
  it('reprend le rapport des sommes du serveur, pas la somme ni la moyenne des taux', () => {
    const m = construireModeleTableau(jeu({ totaux: { taux: 95 } }), spec(), opts)
    expect(m.totaux?.taux).toBe(95)
    expect(m.totaux?.budget).toBe(1000)
    expect(m.totaux?.realise).toBe(950)
  })

  it('sans total serveur : vide plutôt que somme des taux', () => {
    const m = construireModeleTableau(jeu(), spec(), opts)
    expect(m.totaux?.taux).toBeNull()
  })

  it('avec un filtre actif, le total serveur ne vaut plus : vide', () => {
    const m = construireModeleTableau(
      jeu({ totaux: { taux: 95 } }),
      spec({ filtres: [{ cle: 'agence', operateur: 'egal', valeur: 'A' }] }),
      opts
    )
    expect(m.totaux?.taux).toBeNull()
  })
})

describe('N-12 : mois dans l’Excel', () => {
  it('écrit « avr. 2026 » en fr, comme à l’écran', async () => {
    const modele = construireModeleTableau(jeu(), spec(), opts)
    const classeur = await lireClasseur(await construireXlsx(await creerPrep([blocTableau(modele)])))
    const cellules = lignesDeFeuille(classeur.getWorksheet('CA par pays')!).flat()
    expect(cellules).toContain('avr. 2026')
    expect(cellules).not.toContain('2026-04')
  })

  it('suit la locale (en : Apr 2026)', async () => {
    const modele = construireModeleTableau(jeu(), spec(), { locale: 'en' })
    const classeur = await lireClasseur(
      await construireXlsx(await creerPrep([blocTableau(modele)], { locale: 'en' }))
    )
    const cellules = lignesDeFeuille(classeur.getWorksheet('CA par pays')!).flat()
    expect(cellules).toContain('Apr 2026')
  })
})
