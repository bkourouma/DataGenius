import { createConnection, escapeId, type Connection, type RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { MAX_LIGNES_SOURCE, publierLignes, type ColonneSource, type Connecteur, type TableSource } from './contrat'

export const ConnexionMySql = z.strictObject({
  hote: z.string().trim().min(1).max(253).regex(/^(?:[a-z0-9][a-z0-9.-]*|\[[a-f0-9:.]+\])$/i),
  port: z.coerce.number().int().min(1).max(65535),
  base: z.string().min(1).max(64),
  utilisateur: z.string().min(1).max(64),
  motDePasse: z.string().max(1024),
  tls: z.enum(['require', 'disable']),
})
type Configuration = z.infer<typeof ConnexionMySql>

async function lireMySql<T>(config: Configuration, lire: (connexion: Connection) => Promise<T>) {
  const connexion = createConnection({
    host: config.hote.replace(/^\[|\]$/g, ''), port: config.port, database: config.base,
    user: config.utilisateur, password: config.motDePasse,
    ...(config.tls === 'require' ? { ssl: { rejectUnauthorized: true, verifyIdentity: true } } : {}),
    connectTimeout: 5_000, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true,
    decimalNumbers: false, multipleStatements: false, jsonStrings: true,
  })
  try {
    await connexion.promise().query({ sql: 'START TRANSACTION READ ONLY', timeout: 5_000 })
    return await lire(connexion)
  } finally {
    connexion.destroy()
  }
}

export function testerMySql(configuration: Configuration) {
  return lireMySql(configuration, async () => undefined)
}

function verifierBase(configuration: Configuration, table: TableSource) {
  if (table.schema !== configuration.base) throw new Error('Base source indisponible.')
}

function typer(base: string, complet: string): ColonneSource['type'] {
  if (base === 'date') return 'date'
  if (['decimal', 'numeric', 'double', 'float'].includes(base)) return 'decimal'
  if (['tinyint', 'smallint', 'mediumint', 'int', 'bigint'].includes(base) && !(base === 'bigint' && complet.includes('unsigned'))) return 'entier'
  return 'texte'
}

export const mysql: Connecteur<Configuration> = {
  tables(configuration, recherche) {
    return lireMySql(configuration, async connexion => {
      const [lignes] = await connexion.promise().execute<RowDataPacket[]>({
        sql: `SELECT TABLE_SCHEMA AS schema_source, TABLE_NAME AS nom
          FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?
          AND LOCATE(LOWER(?), LOWER(CONCAT(TABLE_SCHEMA, '.', TABLE_NAME))) > 0
          ORDER BY TABLE_NAME LIMIT 201`, timeout: 15_000,
      }, [configuration.base, recherche.slice(0, 120)])
      return { tables: lignes.slice(0, 200).map(l => ({ schema: l.schema_source as string, table: l.nom as string })), tronque: lignes.length > 200 }
    })
  },
  colonnes(configuration, table) {
    verifierBase(configuration, table)
    return lireMySql(configuration, async connexion => {
      const [lignes] = await connexion.promise().execute<RowDataPacket[]>({
        sql: `SELECT COLUMN_NAME AS nom, COLUMN_TYPE AS type_sql, DATA_TYPE AS type_base
          FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          AND FIND_IN_SET('select', PRIVILEGES) > 0 ORDER BY ORDINAL_POSITION`, timeout: 15_000,
      }, [table.schema, table.table])
      return lignes.map(l => ({ nom: l.nom as string, typePostgres: l.type_sql as string, type: typer(l.type_base, l.type_sql) }))
    })
  },
  lire(configuration, jeu) {
    verifierBase(configuration, jeu)
    return lireMySql(configuration, async connexion => {
      const colonne = (nom: string) => escapeId(nom, true)
      const champs = jeu.colonnes.map(c => colonne(c.origine ?? c.nom)).join(', ')
      const table = colonne(jeu.schema) + '.' + colonne(jeu.table)
      const flux = connexion.query({ sql: `SELECT ${champs} FROM ${table} LIMIT ${MAX_LIGNES_SOURCE + 1}`, timeout: 15_000 }).stream({ highWaterMark: 16 })
      return publierLignes(jeu, flux)
    })
  },
}
