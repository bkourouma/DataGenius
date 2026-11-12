import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import type { EntreeCatalogue } from '@/lib/medic-assist/donnees/catalogue/types'
import { appliquerPublicationMetier, colonnesUtiliseesParCatalogue, type DefinitionMetier } from '@/lib/warehouse/modele-metier'

const jeu: EntreeCatalogue = {
  jeu: {
    cle: 'factures', vue: 'mv_factures', description: 'Import brut', granularite: 'Une ligne source',
    libelle: { fr: 'Factures', en: 'Invoices', es: 'Facturas', ar: 'فواتير', hi: 'चालान', zh: '发票' },
    dimensions: [], mesures: [], filtres: [], regles: [],
  },
  vue: {
    nom: 'mv_factures', jeu: 'factures', description: 'Import brut', cte: () => Prisma.empty,
    colonnes: [
      { nom: 'reference', type: 'texte', description: 'Référence' },
      { nom: 'statut', type: 'texte', description: 'Statut' },
      { nom: 'encaisse', type: 'decimal', description: 'Encaissement' },
      { nom: 'facture', type: 'decimal', description: 'Montant facturé' },
    ],
  },
}

const definition: DefinitionMetier = {
  description: 'Factures et paiements', grain: 'Une ligne par facture',
  cles: ['reference'], dimensions: ['statut'],
  colonnes: [{ nom: 'statut', description: 'Statut de paiement', synonymes: ['État du règlement'] }],
  mesures: [{
    cle: 'taux', libelle: 'Taux encaissé', description: 'Encaissements divisés par la facturation',
    agregat: 'rapport', colonne: 'encaisse', denominateur: 'facture',
    filtres: [{ colonne: 'statut', operateur: 'egal', valeur: "Reçu de l'équipe" }],
  }],
}

describe('Catalogue métier publié', () => {
  it('compile un rapport de sommes, paramètre ses filtres et conserve la provenance', () => {
    const enrichi = appliquerPublicationMetier(jeu, { version: 1, definition })
    const mesure = enrichi.jeu.mesures[0]
    expect(mesure.expression).toMatchObject({
      text: '(SUM("encaisse") FILTER (WHERE "statut" = $1::text))::numeric / NULLIF(SUM("facture") FILTER (WHERE "statut" = $2::text), 0)',
      values: ["Reçu de l'équipe", "Reçu de l'équipe"],
    })
    expect(mesure.colonnesRequises).toEqual(['encaisse', 'facture', 'statut'])
    expect(enrichi.jeu.versionMetier).toBe(1)
    expect(enrichi.vue.colonnes[1]).toMatchObject({ description: 'Statut de paiement', synonymes: ['État du règlement'] })
    expect(colonnesUtiliseesParCatalogue(definition)).toEqual(['reference', 'statut', 'encaisse', 'facture'])
    expect(appliquerPublicationMetier(jeu, { version: 2, definition }).vue.signature).not.toBe(enrichi.vue.signature)
  })

  it('refuse une mesure dont le dénominateur est textuel', () => {
    expect(() => appliquerPublicationMetier(jeu, {
      version: 1, definition: { ...definition, mesures: [{ ...definition.mesures[0], denominateur: 'statut' }] },
    })).toThrow('colonnes numériques')
  })
})
