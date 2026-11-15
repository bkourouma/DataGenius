import { describe, expect, it } from 'vitest'
import { construireFormule } from '@/lib/glossaire/formule'
import type { DefinitionMesure } from '@/lib/medic-assist/donnees/catalogue/types'
import { libelle, registreVentes } from './registre-test'

const mesures = registreVentes()[0]!.jeu.mesures as DefinitionMesure[]
const [ca, taux] = mesures

describe('construireFormule', () => {
  it('décrit une agrégation simple sans conditions', () => {
    expect(construireFormule(ca!, 'fr')).toEqual({ agregat: 'somme', colonne: 'montant_ht', regles: [] })
  })

  it('prend numérateur et dénominateur d’un rapport et les conditions dans la langue demandée', () => {
    expect(construireFormule(taux!, 'fr')).toEqual({
      agregat: 'rapport', colonne: 'marge', denominateur: 'montant_ht', regles: ['agence = Lagune'],
    })
    expect(construireFormule(taux!, 'en').regles).toEqual(['agency = Lagune'])
  })

  it('ne lit jamais l’expression SQL et ne la retourne pas', () => {
    expect(JSON.stringify(construireFormule(ca!, 'fr'))).not.toContain('SUM(')
  })

  it('n’expose pas une colonne absente de la vue autorisée', () => {
    const formule = construireFormule(taux!, 'fr', new Set(['montant_ht']))
    expect(formule.colonne).toBeNull()
    expect(formule.denominateur).toBe('montant_ht')
  })

  it('accepte un comptage sans colonne', () => {
    const mesure = { ...ca!, agregat: 'nombre', colonnesRequises: undefined, regles: [libelle('actif')] } as DefinitionMesure
    expect(construireFormule(mesure, 'fr')).toEqual({ agregat: 'nombre', colonne: null, regles: ['actif'] })
  })
})
