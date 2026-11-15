import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import { chargerIncremental, enregistrerIncremental } from '@/lib/warehouse/incremental-admin'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { enregistrerQualite } from '@/lib/warehouse/qualite-admin'
import { ajouterSource, creerImport } from '@/lib/warehouse/sources-admin'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Import incrémental PostgreSQL', () => {
  afterAll(async () => { await Promise.all([prisma.$disconnect(), deconnecterPostgres()]) })

  it('importe 60 000 lignes, reprend les horodatages égaux et publie les suppressions à la réconciliation', async () => {
    const url = new URL(process.env.DATAGENIUS_SOURCE_SUPPORT ?? '')
    const urlEcriture = new URL(process.env.DATAGENIUS_TEST_SUPPORT_OWNER_URL ?? '')
    if ([url.pathname, urlEcriture.pathname].some(base => base !== '/dg_support') ||
        new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') {
      throw new Error('Utiliser les bases fictives de la recette.')
    }
    const redacteur = new PrismaClient({ datasourceUrl: urlEcriture.href })
    const nom = 'incremental_' + randomUUID().replaceAll('-', '')
    const table = Prisma.raw('support.' + nom)
    let source: string | undefined
    let jeu: string | undefined
    try {
      await redacteur.$executeRaw`CREATE TABLE ${table} (id int NOT NULL, valeur int, modifie_a timestamptz)`
      await redacteur.$executeRaw`GRANT SELECT ON ${table} TO dg_support_reader`
      await redacteur.$executeRaw`INSERT INTO ${table} SELECT id, id, '2026-01-01Z'::timestamptz + id * interval '1 second' FROM generate_series(1, 60000) AS id`
      source = await ajouterSource({ titre: 'Source incrémentale', hote: url.hostname, port: url.port || '5432',
        base: 'dg_support', utilisateur: url.username, motDePasse: decodeURIComponent(url.password), tls: 'disable' })
      const cle = await creerImport({ sourceId: source, titre: 'Deltas de recette', schema: 'support', table: nom,
        colonnes: ['id', 'valeur', 'modifie_a'], description: '', frequenceMinutes: 60 })
      jeu = cle
      const config = { cles: ['id'], dateModification: 'modifie_a', chevauchementMinutes: 0, reconciliationMinutes: 1440 }
      await expect(enregistrerIncremental(cle, 0, { ...config, dateModification: 'valeur' })).rejects.toThrow('horodatage')
      await enregistrerIncremental(cle, 0, config)
      expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'publie' }])
      const premier = (await chargerIncremental(cle))?.etat
      expect(premier?.curseur).toBe('2026-01-01T16:40:00.000000Z')

      await redacteur.$executeRaw`UPDATE ${table} SET valeur = 999, modifie_a = '2026-01-01T16:40:00Z' WHERE id = 1`
      await redacteur.$executeRaw`UPDATE ${table} SET valeur = 998, modifie_a = '2026-01-01T16:40:01.000123Z' WHERE id = 2`
      await redacteur.$executeRaw`DELETE FROM ${table} WHERE id = 3`
      const delta = () => synchroniserEntrepot({ jeu: cle, forcer: true })
      const reconciliation = () => synchroniserEntrepot({ jeu: cle, reconcilier: true })
      const copie = async () => (await prisma.$queryRaw<{ lignes: number; total: number }[]>`
        SELECT lignes, (SELECT sum((j->>'valeur')::int)::int FROM jsonb_array_elements(contenu) AS j) AS total
        FROM warehouse.snapshots WHERE jeu = ${cle}
      `)[0]
      expect(await delta()).toEqual([{ jeu: cle, statut: 'publie' }])
      const publication = await copie()
      expect(publication).toEqual({ lignes: 60_000, total: 1_800_031_994 })
      expect((await chargerIncremental(cle))?.etat?.curseur).toBe('2026-01-01T16:40:01.000123Z')
      expect(await delta()).toEqual([{ jeu: cle, statut: 'identique' }])
      expect(await reconciliation()).toEqual([{ jeu: cle, statut: 'publie' }])
      expect(await copie()).toEqual({ lignes: 59_999, total: 1_800_031_991 })

      await redacteur.$executeRaw`INSERT INTO ${table} VALUES (2, 9, '2026-01-01Z')`
      expect(await reconciliation()).toEqual([{ jeu: cle, statut: 'echec', code: 'incremental_cle' }])
      expect((await copie()).lignes).toBe(59_999)
      await redacteur.$executeRaw`DELETE FROM ${table} WHERE id = 2 AND valeur = 9`
      await redacteur.$executeRaw`UPDATE ${table} SET valeur = -5, modifie_a = '2026-01-01T16:40:02Z' WHERE id = 2`
      await enregistrerQualite(cle, 0, { filtres: [], normalisations: [], controles: [
        { type: 'plage', colonnes: ['valeur'], min: '0' },
      ] })
      expect(await delta()).toEqual([{ jeu: cle, statut: 'echec', code: 'plage' }])
      expect((await chargerIncremental(cle))?.etat?.curseur).toBe('2026-01-01T16:40:01.000123Z')
      expect(await copie()).toEqual({ lignes: 59_999, total: 1_800_031_991 })
      const executions = await prisma.$queryRaw<{ mode: string | null; lignes: number; code: string | null }[]>`
        SELECT mode_lecture AS mode, lignes_lues AS lignes, code
        FROM warehouse.executions WHERE jeu = ${cle} ORDER BY id
      `
      expect(executions[1]).toEqual({ mode: 'delta', lignes: 3, code: null })
      expect(executions.at(-2)?.code).toBe('incremental_cle')
      expect(executions.at(-1)?.code).toBe('plage')

      await redacteur.$executeRaw`UPDATE ${table} SET valeur = 8, modifie_a = '2026-01-01T16:40:03Z' WHERE id = 2`
      await redacteur.$executeRaw`DELETE FROM ${table} WHERE id = 4`
      await prisma.$executeRaw`UPDATE warehouse.incremental SET reconcilie_a = now() - interval '2 days' WHERE jeu = ${cle}`
      await prisma.$executeRaw`UPDATE warehouse.synchronisations SET verifie_a = now() - interval '1 minute' WHERE jeu = ${cle}`
      expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'pas_echu', code: 'backoff' }])
      await prisma.$executeRaw`UPDATE warehouse.synchronisations SET verifie_a = now() - interval '25 hours', prochain_essai_a = NULL WHERE jeu = ${cle}`
      expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'publie' }])
      expect(await copie()).toEqual({ lignes: 59_998, total: 1_800_030_997 })
    } finally {
      if (jeu) {
        await prisma.$executeRaw`DELETE FROM warehouse.executions WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.synchronisations WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${jeu}`
      }
      if (source) await prisma.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${source}`
      await redacteur.$executeRaw`DROP TABLE IF EXISTS ${table}`
      await redacteur.$disconnect()
    }
  }, 60_000)
})
