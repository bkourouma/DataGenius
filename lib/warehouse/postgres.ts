import { Prisma, PrismaClient } from '@prisma/client'
import { DELAI_SQL_MS, ErreurDonnees } from '@/lib/medic-assist/donnees/types'

const connexions = new Map<string, PrismaClient>()

export function identitePostgres(variable: string) {
  const valeur = process.env[variable]
  if (!valeur) return null
  try {
    const url = new URL(valeur)
    if (['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname && url.pathname.length > 1) {
      return [url.hostname.toLowerCase(), url.port || '5432', decodeURIComponent(url.pathname), decodeURIComponent(url.username)]
    }
  } catch {
    // Une configuration invalide reste indisponible.
  }
  return null
}

export async function deconnecterPostgres() {
  const clients = [...connexions.values()]
  connexions.clear()
  await Promise.all(clients.map(client => client.$disconnect()))
}

export async function transactionLecture<T>(
  variable: string,
  lire: (tx: Prisma.TransactionClient) => Promise<T>,
  delaiMs = DELAI_SQL_MS,
): Promise<T> {
  const url = process.env[variable]
  if (!url || !identitePostgres(variable)) {
    throw new ErreurDonnees('Connexion PostgreSQL de lecture indisponible.', 'role_lecture_absent')
  }
  let client = connexions.get(url)
  if (!client) {
    client = new PrismaClient({ datasourceUrl: url })
    connexions.set(url, client)
  }

  return executerTransaction(client, lire, delaiMs)
}

export async function transactionLectureUrl<T>(
  url: string, lire: (tx: Prisma.TransactionClient) => Promise<T>, delaiMs = DELAI_SQL_MS,
): Promise<T> {
  const client = new PrismaClient({ datasourceUrl: url })
  try {
    return await executerTransaction(client, lire, delaiMs)
  } finally {
    await client.$disconnect()
  }
}

async function executerTransaction<T>(
  client: PrismaClient, lire: (tx: Prisma.TransactionClient) => Promise<T>, delaiMs: number,
): Promise<T> {
  const delai = Number.isFinite(delaiMs) ? Math.max(1, Math.min(DELAI_SQL_MS, Math.trunc(delaiMs))) : DELAI_SQL_MS
  return client.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    await tx.$queryRaw`SELECT pg_catalog.set_config('statement_timeout', ${String(delai)}, true)`
    await tx.$queryRaw`SELECT pg_catalog.set_config('search_path', 'pg_catalog', true)`
    const [role] = await tx.$queryRaw<{ autorise: boolean }[]>`
      SELECT NOT pg_catalog.pg_has_role(current_user, datdba, 'MEMBER')
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_roles
           WHERE pg_catalog.pg_has_role(current_user, oid, 'MEMBER')
             AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
               OR rolname IN ('pg_read_all_data', 'pg_write_all_data'))
         ) AS autorise
      FROM pg_catalog.pg_database
      WHERE datname = current_database()
    `
    if (!role?.autorise) {
      throw new ErreurDonnees('Configurez un compte PostgreSQL de lecture dédié.', 'role_lecture_absent')
    }
    return lire(tx)
  }, { isolationLevel: 'RepeatableRead', timeout: delai + 5_000, maxWait: 5_000 })
}
