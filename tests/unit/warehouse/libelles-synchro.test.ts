import { describe, expect, it } from 'vitest'
import { LIBELLE_ECHEC_GENERIQUE, libelleEchec, retourSynchro } from '@/lib/warehouse/libelles-synchro'

const CODES = ['source', 'schema', 'volume', 'plage', 'unique', 'non_nul', 'configuration', 'incremental_cle', 'incremental_date',
  'interne', 'delai', 'bail_perdu', 'configuration_modifiee', 'enregistrement_impossible', 'backoff']

describe('retourSynchro', () => {
  it('traduit les cinq statuts', () => {
    expect(retourSynchro({ statut: 'en_cours' })).toEqual({ succes: 'Synchronisation déjà en cours.' })
    expect(retourSynchro({ statut: 'publie' })).toEqual({ succes: 'Données publiées.' })
    expect(retourSynchro({ statut: 'identique' })).toEqual({ succes: 'Aucun changement : les données sont identiques.' })
    expect(retourSynchro({ statut: 'pas_echu' })).toEqual({ succes: 'Aucune synchronisation nécessaire pour l’instant.' })
    expect(retourSynchro({ statut: 'echec', code: 'source' })).toEqual({ erreur: 'Échec : la source est injoignable ou a refusé la lecture.' })
  })

  it('explique le report après plusieurs échecs', () => {
    expect(retourSynchro({ statut: 'pas_echu', code: 'backoff' })).toEqual({ succes: 'Nouvel essai automatique prévu après plusieurs échecs.' })
  })

  it('donne un libellé distinct et lisible à chaque code connu', () => {
    const libelles = CODES.map(libelleEchec)
    expect(new Set(libelles).size).toBe(CODES.length)
    expect(libelles).not.toContain(LIBELLE_ECHEC_GENERIQUE)
  })

  it('reste générique pour un code inconnu, absent ou hérité', () => {
    for (const code of ['inconnu', undefined, null, '', 'constructor', '__proto__']) {
      expect(retourSynchro({ statut: 'echec', code })).toEqual({ erreur: 'Échec : ' + LIBELLE_ECHEC_GENERIQUE })
    }
    expect(retourSynchro({ statut: 'bizarre' }).erreur).toMatch(/impossible/)
  })
})
