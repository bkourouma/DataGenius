import { describe, expect, it } from 'vitest'

import { reponseVersClient, resumeVersClient } from '@/lib/medic-assist/artefacts/client-mapper'
import type { ArtefactReponse } from '@/lib/medic-assist/artefacts/reponse'

import { artefactTest, jeuTest, reponseApi } from './_fixtures-artefacts-ui'

describe('reponseVersClient', () => {
  it('convertit jeux (métadonnées + lignes), versions, droits et dates', () => {
    const jeu = { ...jeuTest('jeu-1'), totaux: { ca: 2000 } }
    const client = artefactTest('tableau', {
      version: 2,
      versions: [
        { version: 1, creeLe: '2026-11-02T08:00:00.000Z' },
        { version: 2, creeLe: '2026-11-02T09:00:00.000Z' },
      ],
      jeux: { 'jeu-1': jeu },
      creeLe: '2026-11-02T08:00:00.000Z',
    })
    const converti = reponseVersClient(reponseApi(client))

    expect(converti.id).toBe(client.id)
    expect(converti.version).toBe(2)
    expect(converti.versions).toEqual(client.versions)
    expect(converti.titre).toBe(client.titre)
    expect(converti.spec).toEqual(client.spec)
    expect(converti.conversationId).toBe('conv-1')
    expect(converti.creeLe).toBe('2026-11-02T08:00:00.000Z')
    expect(converti.modifiable).toBe(true)
    expect(converti.jeux['jeu-1']).toEqual({
      jeuDeDonneesId: 'jeu-1',
      colonnes: jeu.colonnes,
      lignes: jeu.lignes,
      nbLignes: 2,
      tronque: false,
      totaux: { ca: 2000 },
      provenance: jeu.provenance,
    })
    expect(converti.artefactsLies).toBeUndefined()
  })

  it('modifiable suit droits.modification, pas le propriétaire', () => {
    const reponse = reponseApi(artefactTest('tableau', { modifiable: false }))
    expect(reponse.droits.modification).toBe(false)
    expect(reponseVersClient(reponse).modifiable).toBe(false)
  })

  it('sous-titre lu dans la spécification', () => {
    const client = artefactTest('tableau', { sousTitre: 'Avril à octobre 2026' })
    const converti = reponseVersClient(reponseApi(client))
    expect(converti.sousTitre).toBe('Avril à octobre 2026')
    expect(reponseVersClient(reponseApi(artefactTest('tableau'))).sousTitre).toBeUndefined()
  })

  it('un jeu sans lignes dans `donnees` donne un jeu vide (jamais d’exception)', () => {
    const reponse = reponseApi(artefactTest('tableau'))
    reponse.donnees = {}
    const converti = reponseVersClient(reponse)
    expect(converti.jeux['jeu-1'].lignes).toEqual([])
    expect(converti.jeux['jeu-1'].nbLignes).toBe(2)
  })

  describe('racineId', () => {
    it('celui de la réponse quand elle en porte un', () => {
      const reponse = reponseApi(artefactTest('tableau', { id: 'v2', racineId: 'racine' }))
      expect(reponseVersClient(reponse).racineId).toBe('racine')
    })

    it('sinon celui que l’appelant connaît, sinon l’id', () => {
      const sans = reponseApi(artefactTest('tableau', { id: 'v2', racineId: 'racine' }), false)
      expect(reponseVersClient(sans, { racineId: 'connue' }).racineId).toBe('connue')
      expect(reponseVersClient(sans).racineId).toBe('v2')
    })
  })

  describe('artefacts liés', () => {
    it('convertis sur un niveau seulement', () => {
      const petitFils = artefactTest('tableau', { id: 'pf' })
      const lie = artefactTest('graphique', { id: 'lie' })
      const reponseLie = reponseApi(lie)
      reponseLie.artefactsLies = { pf: reponseApi(petitFils) }
      const reponse: ArtefactReponse = {
        ...reponseApi(artefactTest('document', { id: 'doc' })),
        artefactsLies: { lie: reponseLie },
      }
      const converti = reponseVersClient(reponse)
      expect(Object.keys(converti.artefactsLies ?? {})).toEqual(['lie'])
      const convertiLie = converti.artefactsLies?.lie
      expect(convertiLie?.type).toBe('graphique')
      expect(convertiLie?.jeux['jeu-1'].lignes).toHaveLength(2)
      expect(convertiLie?.artefactsLies).toBeUndefined()
    })
  })
})

describe('resumeVersClient', () => {
  it('reprend id, racine, version, type, titre, sous-titre et majA', () => {
    expect(
      resumeVersClient({
        id: 'a2',
        racineId: 'a1',
        type: 'graphique',
        titre: 'Courbe',
        sousTitre: 'Mensuel',
        version: 2,
        majA: '2026-11-02T09:00:00.000Z',
      })
    ).toEqual({
      id: 'a2',
      racineId: 'a1',
      type: 'graphique',
      titre: 'Courbe',
      sousTitre: 'Mensuel',
      version: 2,
      majA: '2026-11-02T09:00:00.000Z',
    })
  })

  it('omet le sous-titre absent', () => {
    const r = resumeVersClient({
      id: 'a',
      racineId: 'a',
      type: 'tableau',
      titre: 'T',
      version: 1,
      majA: '2026-11-02T09:00:00.000Z',
    })
    expect('sousTitre' in r).toBe(false)
  })
})
