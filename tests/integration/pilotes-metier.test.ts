import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { construireExport } from '@/lib/medic-assist/artefacts/exports'
import { creerArtefact } from '@/lib/medic-assist/artefacts/stockage'
import { calculerSemantique } from '@/lib/medic-assist/donnees/moteur/calculer'
import { interrogerDonnees } from '@/lib/medic-assist/donnees/outils'
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
  let ecritures: string
  const definitionFactures = {
    description: 'Une ligne par facture émise', grain: 'Une ligne par facture émise',
    cles: ['facture_id'], dimensions: ['devise'], colonnes: [],
    mesures: [{ cle: 'facture_xof', libelle: 'Montant facturé en XOF', description: 'Somme des factures en XOF',
      colonne: 'montant', agregat: 'somme', devise: 'XOF', filtres: [{ colonne: 'devise', operateur: 'egal', valeur: 'XOF' }] }],
  }

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
    await prisma.user.create({ data: { id: contexte.userId, email: contexte.userId + '@example.test',
      firstName: 'Pilote', passwordHash: 'fixture', roleName: 'TenantAdmin' } })
    factures = await importer(entreprise, 'Factures du pilote', 'finance', 'factures', ['facture_id', 'equipe', 'devise', 'montant', 'emise_le'])
    ecritures = await importer(entreprise, 'Écritures précises', 'finance', 'ecritures', ['libelle', 'montant'])
    reglements = await importer(operations, 'Règlements du pilote', 'facturation', 'reglements', ['reglement_id', 'facture_id', 'montant'])
    tickets = await importer(operations, 'Tickets du pilote', 'support', 'tickets', ['ticket_id', 'equipe', 'statut', 'resolution_minutes'])
  })

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { id: contexte.userId } })
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
    await expect(publierCatalogueMetier(factures, 0, definitionFactures, contexte.userId)).resolves.toBe(1)

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

  it('applique un exercice de novembre à octobre et conserve les trimestres civils', async () => {
    const catalogue = (await chargerCatalogueMetier(factures))!
    const calendrierFiscal = { colonneDate: 'emise_le', moisDebutExercice: 11 }
    await publierCatalogueMetier(factures, catalogue.version, { ...definitionFactures, calendrierFiscal }, contexte.userId)
    const requete = { jeu: factures, mesures: ['facture_xof'] }
    const resultat = await calculerSemantique({ ...requete, granularite: 'exercice', filtres: { periode: { exercice: 2025 } } }, contexte)
    expect(resultat.lignes).toEqual([{ exercice: '2025/2026', facture_xof: 380 }])
    expect(resultat.provenance.periode).toMatchObject({ debut: '2025-11', fin: '2026-10' })
    expect(resultat.provenance.periode?.libelle).toContain('2025/2026')
    expect((await calculerSemantique({ ...requete, granularite: 'mois', filtres: { periode: { exercice: 2026 } } }, contexte)).lignes).toEqual([])
    expect((await calculerSemantique({ ...requete, granularite: 'mois' }, contexte)).lignes)
      .toEqual([{ periode: '2026-10', facture_xof: 380 }])
    expect((await calculerSemantique({ ...requete, granularite: 'trimestre' }, contexte)).lignes)
      .toEqual([{ trimestre: '2026-T4', facture_xof: 380 }])
    expect((await calculerSemantique({ ...requete, granularite: 'annee' }, contexte)).lignes)
      .toEqual([{ annee: '2026', facture_xof: 380 }])
  })

  it('conserve les montants décimaux exacts de PostgreSQL jusqu’aux exports CSV et Excel', async () => {
    await publierCatalogueMetier(ecritures, 0, {
      description: 'Journal comptable', grain: 'Une ligne par écriture', cles: ['libelle'], dimensions: ['libelle'], colonnes: [],
      mesures: [{ cle: 'solde', libelle: 'Solde', description: 'Somme signée des écritures', colonne: 'montant', agregat: 'somme' }],
    }, contexte.userId)
    const resultat = await interrogerDonnees(contexte, { jeu: ecritures, mesures: ['solde'], dimensions: ['libelle'] })
    expect(resultat.apercu).toContainEqual({ libelle: 'Crédit', solde: '9007199254740993.25' })
    expect(resultat.totaux).toEqual({ solde: '9007199254740993.15' })
    const artefact = await creerArtefact(contexte, {
      spec: { type: 'tableau', titre: 'Journal comptable', jeuDeDonneesId: resultat.jeuDeDonneesId, totaux: true },
    })
    const csv = (await construireExport(contexte, artefact.artefactId, 'csv')).buffer.toString('utf8')
    expect(csv).toContain('9007199254740993,25')
    expect(csv).toContain('9007199254740993,15')
    const excel = await construireExport(contexte, artefact.artefactId, 'xlsx')
    const classeur = new ExcelJS.Workbook()
    await classeur.xlsx.load(excel.buffer as unknown as ArrayBuffer)
    const cellules: unknown[] = []
    classeur.worksheets[0].eachRow(ligne => ligne.eachCell(cellule => { cellules.push(cellule.value) }))
    expect(cellules).toContain('9007199254740993.25')
    expect(cellules).toContain('9007199254740993.15')
  })
})
