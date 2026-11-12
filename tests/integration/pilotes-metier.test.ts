import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { calculerSemantique } from '@/lib/medic-assist/donnees/moteur/calculer'
import { chargerCatalogueMetier, publierCatalogueMetier } from '@/lib/warehouse/catalogue-metier'
import { creerCombinaison, previsualiserCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { ajouterSource, creerImport } from '@/lib/warehouse/sources-admin'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Pilotes métier Data Genius', () => {
  const contexte: ContexteExecution = {
    userId: randomUUID(), roleName: 'TenantAdmin', scope: { roleName: 'TenantAdmin', voitTout: true },
    habilitations: null, locale: 'fr', maintenant: new Date('2026-11-12T12:00:00Z'), jourLimite: 1,
  }
  const sources: string[] = []
  const imports: string[] = []
  const combinaisons: string[] = []
  let factures: string
  let reglements: string
  let tickets: string

  async function ajouterBase(variable: string, titre: string, base: string) {
    const url = new URL(process.env[variable] ?? '')
    if (url.pathname !== '/' + base) throw new Error('Utiliser les bases fictives de la recette.')
    const id = await ajouterSource({ titre, hote: url.hostname, port: url.port || '5432', base,
      utilisateur: url.username, motDePasse: decodeURIComponent(url.password), tls: 'disable' })
    sources.push(id)
    return id
  }

  async function importer(sourceId: string, titre: string, schema: string, table: string, colonnes: string[]) {
    const jeu = await creerImport({ sourceId, titre, schema, table, colonnes, description: '', frequenceMinutes: 10 })
    imports.push(jeu)
    expect(await synchroniserEntrepot({ jeu })).toEqual([{ jeu, statut: 'publie' }])
    return jeu
  }

  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') {
      throw new Error('Utiliser la base fictive dg_app.')
    }
    const entreprise = await ajouterBase('DATAGENIUS_SOURCE_DISTRIBUTION', 'Pilote services', 'dg_source')
    const operations = await ajouterBase('DATAGENIUS_SOURCE_SUPPORT', 'Pilote opérations', 'dg_support')
    factures = await importer(entreprise, 'Factures du pilote', 'finance', 'factures', ['facture_id', 'equipe', 'devise', 'montant'])
    reglements = await importer(operations, 'Règlements du pilote', 'facturation', 'reglements', ['reglement_id', 'facture_id', 'montant'])
    tickets = await importer(operations, 'Tickets du pilote', 'support', 'tickets', ['ticket_id', 'equipe', 'statut', 'resolution_minutes'])
  })

  afterAll(async () => {
    try {
      for (const jeu of [...combinaisons, ...imports]) await prisma.$executeRaw`DELETE FROM warehouse.catalogue_metier WHERE jeu = ${jeu}`
      for (const jeu of combinaisons) await prisma.$executeRaw`DELETE FROM warehouse.combinaisons WHERE cle = ${jeu}`
      for (const jeu of imports) {
        await prisma.$executeRaw`DELETE FROM warehouse.synchronisations WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${jeu}`
      }
      for (const id of sources) await prisma.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${id}`
    } finally {
      await Promise.all([prisma.$disconnect(), deconnecterPostgres()])
    }
  })

  it('calcule les factures et encaissements partiels à leurs granularités respectives', async () => {
    const description = 'Une ligne par facture émise'
    await expect(publierCatalogueMetier(factures, 0, {
      description, grain: description, cles: ['facture_id'], dimensions: ['devise'], colonnes: [],
      mesures: [{ cle: 'facture_xof', libelle: 'Montant facturé en XOF', description: 'Somme des factures en XOF',
        colonne: 'montant', agregat: 'somme', devise: 'XOF', filtres: [{ colonne: 'devise', operateur: 'egal', valeur: 'XOF' }] }],
    }, contexte.userId)).resolves.toBe(1)

    const choix = { gauche: factures, droite: reglements, type: 'gauche',
      liens: [{ gauche: 'facture_id', droite: 'facture_id' }],
      colonnes: [{ cote: 'gauche', nom: 'facture_id' }, { cote: 'gauche', nom: 'devise' }, { cote: 'droite', nom: 'montant' }],
    }
    const apercu = await previsualiserCombinaison(choix, contexte)
    expect(apercu.lignes.filter(ligne => ligne.cellules[0] === 'F-001')).toHaveLength(2)
    expect(apercu.lignes.filter(ligne => !ligne.correspondance)).toHaveLength(2)
    expect(apercu.diagnostic).toMatchObject({
      resultat: '5',
      gauche: { lignes: '4', correspondances: '2', sansCorrespondance: '2', lignesMultipliees: '1' },
      droite: { lignes: '3', clesDupliquees: '1' },
      totaux: [{ cote: 'droite', colonne: { nom: 'montant' }, avant: '250.00', apres: '250.00' }],
    })
    const jeu = await creerCombinaison({ ...choix, titre: 'Encaissements et factures', description: '' })
    combinaisons.push(jeu)
    await publierCatalogueMetier(jeu, 0, {
      description: 'Encaissements des factures', grain: 'Une ligne par règlement, ou par facture sans règlement',
      cles: [], dimensions: ['facture_id', 'devise'], colonnes: [],
      mesures: [{ cle: 'encaisse_xof', libelle: 'Montant encaissé', description: 'Somme des règlements en XOF',
        colonne: 'montant', agregat: 'somme', devise: 'XOF', filtres: [{ colonne: 'devise', operateur: 'egal', valeur: 'XOF' }] }],
    }, contexte.userId)
    expect((await calculerSemantique({ jeu: factures, mesures: ['facture_xof'] }, contexte)).lignes)
      .toEqual([{ facture_xof: 380 }])
    expect((await calculerSemantique({ jeu, mesures: ['encaisse_xof'] }, contexte)).lignes)
      .toEqual([{ encaisse_xof: 250 }])
  })

  it('publie et versionne le délai de résolution sans traiter les tickets ouverts comme des zéros', async () => {
    const definition = {
      description: 'Suivi du support', grain: 'Une ligne par ticket', cles: ['ticket_id'], dimensions: ['equipe'],
      colonnes: [{ nom: 'resolution_minutes', description: 'Délai de résolution en minutes', synonymes: ['temps de traitement'] }],
      mesures: [{ cle: 'delai_moyen', libelle: 'Délai moyen', description: 'Moyenne des délais des tickets résolus',
        colonne: 'resolution_minutes', agregat: 'moyenne', unite: 'minutes',
        filtres: [{ colonne: 'statut', operateur: 'egal', valeur: 'resolu' }] }],
    }
    await expect(publierCatalogueMetier(tickets, 0, definition, contexte.userId)).resolves.toBe(1)
    await expect(publierCatalogueMetier(tickets, 1, { ...definition, responsable: 'Équipe support' }, contexte.userId)).resolves.toBe(2)
    const catalogue = await chargerCatalogueMetier(tickets)
    expect(catalogue?.historique.map(v => v.version)).toEqual([2, 1])
    const resultat = await calculerSemantique({ jeu: tickets, dimensions: ['equipe'], mesures: ['delai_moyen'] }, contexte)
    expect(Object.fromEntries(resultat.lignes.map(ligne => [ligne.equipe, ligne.delai_moyen])))
      .toEqual({ Nord: 60, Sud: 120 })
    expect(resultat.totaux).toEqual({ delai_moyen: 80 })
  })
})
