import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import ExcelJS from 'exceljs'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { calculerSql } from '@/lib/medic-assist/donnees/sql/calcul'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import {
  ajouterSourceFichier, ajouterSourceMySql, ajouterSourceRest, creerImport, listerColonnes, listerTables, remplacerSourceFichier,
} from '@/lib/warehouse/sources-admin'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Connecteurs administrés', () => {
  const contexte: ContexteExecution = {
    userId: randomUUID(), roleName: 'TenantAdmin', scope: { roleName: 'TenantAdmin', voitTout: true },
    habilitations: null, locale: 'fr', maintenant: new Date(), jourLimite: 1,
  }
  const sources: string[] = []
  const jeux: string[] = []

  async function publier(sourceId: string, schema: string, table: string, colonnes: string[]) {
    const jeu = await creerImport({ sourceId, schema, table, colonnes, titre: 'Recette ' + table, description: '', frequenceMinutes: 10 })
    jeux.push(jeu)
    expect(await synchroniserEntrepot({ jeu })).toEqual([{ jeu, statut: 'publie' }])
    return jeu
  }

  afterAll(async () => {
    try {
      for (const jeu of jeux) {
        await prisma.$executeRaw`DELETE FROM warehouse.synchronisations WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${jeu}`
      }
      for (const source of sources) await prisma.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${source}`
    } finally {
      await Promise.all([prisma.$disconnect(), deconnecterPostgres()])
    }
  })

  it('publie un fichier CSV, puis actualise le même jeu depuis le fichier remplacé', async () => {
    const texteLong = 'Pomme '.repeat(400) + 'bio'
    const csv = (quantite: number) => ({ nom: 'inventaire.csv', contenu: Buffer.from(`produit;quantite\n${texteLong};${quantite}\nOrange;2\n`) })
    const source = await ajouterSourceFichier('Fichier test', csv(4))
    sources.push(source)
    expect((await listerTables(source)).tables).toEqual([{ schema: 'fichier', table: 'donnees' }])
    const jeu = await publier(source, 'fichier', 'donnees', ['produit', 'quantite'])
    const total = async () => (await calculerSql({ objectif: 'Total importé', sql: `SELECT SUM(quantite) AS total FROM mv_${jeu}` }, contexte)).lignes
    expect(await total()).toEqual([{ total: 6 }])
    const detail = await calculerSql({ objectif: 'Produit CSV', sql: `SELECT produit FROM mv_${jeu}` }, contexte)
    expect(detail.lignes).toContainEqual({ produit: texteLong })
    await remplacerSourceFichier(source, csv(7))
    expect(await total()).toEqual([{ total: 6 }])
    expect(await synchroniserEntrepot({ jeu, forcer: true })).toEqual([{ jeu, statut: 'publie' }])
    expect(await total()).toEqual([{ total: 9 }])
  })

  it('sélectionne une feuille Excel et conserve les dates et nombres du classeur', async () => {
    const classeur = new ExcelJS.Workbook()
    const feuille = classeur.addWorksheet('Produits')
    feuille.addRows([['Produit', 'Date', 'Prix'], ['A', new Date('2026-10-01T00:00:00Z'), 24.5], ['B', new Date('2026-10-02T00:00:00Z'), 8.25]])
    const source = await ajouterSourceFichier('Classeur test', { nom: 'produits.xlsx', contenu: new Uint8Array(await classeur.xlsx.writeBuffer()) })
    sources.push(source)
    expect((await listerTables(source)).tables).toEqual([{ schema: 'fichier', table: 'Produits' }])
    const jeu = await publier(source, 'fichier', 'Produits', ['produit', 'date', 'prix'])
    const { lignes } = await calculerSql({ objectif: 'Prix Excel', sql: `SELECT produit, date, prix FROM mv_${jeu} ORDER BY produit` }, contexte)
    expect(lignes).toEqual([{ produit: 'A', date: '2026-10-01', prix: 24.5 }, { produit: 'B', date: '2026-10-02', prix: 8.25 }])
  })

  it('enregistre et synchronise une API REST paginée authentifiée', async () => {
    const ancien = process.env.DATAGENIUS_REST_ORIGINES_PRIVEES
    const serveur = createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer essai-secret') { res.writeHead(401).end(); return }
      const page = Number(new URL(req.url ?? '/', 'http://local').searchParams.get('page'))
      const articles = page < 3 ? [{ reference: `API${page}`, nombre: page + 3 }] : []
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ articles }))
    })
    try {
      const port = await new Promise<number>(resolve => serveur.listen(0, '127.0.0.1', () => {
        const adresse = serveur.address()
        if (typeof adresse === 'object' && adresse) resolve(adresse.port)
      }))
      const origine = `http://127.0.0.1:${port}`
      process.env.DATAGENIUS_REST_ORIGINES_PRIVEES = origine
      const source = await ajouterSourceRest('API test', { url: `${origine}/articles`, token: 'essai-secret', chemin: 'articles', parametrePage: 'page' })
      sources.push(source)
      const [stockage] = await prisma.$queryRaw<{ secret: string }[]>`SELECT secret FROM warehouse.sources WHERE id = ${source}`
      expect(stockage.secret).not.toContain('essai-secret')
      const jeu = await publier(source, 'api', 'donnees', ['reference', 'nombre'])
      const { lignes } = await calculerSql({ objectif: 'Pages importées', sql: `SELECT SUM(nombre) AS total FROM mv_${jeu}` }, contexte)
      expect(lignes).toEqual([{ total: 9 }])
    } finally {
      if (ancien === undefined) delete process.env.DATAGENIUS_REST_ORIGINES_PRIVEES
      else process.env.DATAGENIUS_REST_ORIGINES_PRIVEES = ancien
      serveur.closeAllConnections()
      await new Promise<void>(resolve => serveur.close(() => resolve()))
    }
  })

  it.skipIf(!process.env.DATAGENIUS_TEST_MYSQL_URL)('découvre et importe des données dans un serveur MySQL réel', async () => {
    const url = new URL(process.env.DATAGENIUS_TEST_MYSQL_URL ?? '')
    const base = 'dg_source_mysql'
    if (url.pathname !== '/' + base) throw new Error('Utiliser la base MySQL fictive de la recette.')
    const source = await ajouterSourceMySql('MySQL test', { hote: url.hostname, port: url.port || '3306', base,
      utilisateur: decodeURIComponent(url.username), motDePasse: decodeURIComponent(url.password), tls: 'disable' })
    sources.push(source)
    const table = { schema: base, table: 'ventes' }
    expect((await listerTables(source, 'ventes')).tables).toContainEqual(table)
    expect((await listerColonnes(source, table)).map(c => c.nom)).toEqual(['id', 'montant', 'jour'])
    const jeu = await publier(source, base, 'ventes', ['id', 'montant', 'jour'])
    const { lignes } = await calculerSql({ objectif: 'Somme MySQL', sql: `SELECT SUM(montant) AS total FROM mv_${jeu}` }, contexte)
    expect(lignes).toEqual([{ total: 31.23 }])
    const detail = await calculerSql({ objectif: 'Identifiants MySQL', sql: `SELECT id FROM mv_${jeu} ORDER BY id` }, contexte)
    expect(detail.lignes).toEqual([{ id: '9007199254740993' }, { id: '9007199254740994' }])
  })
})
