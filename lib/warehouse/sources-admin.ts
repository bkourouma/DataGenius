import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import type { TypeColonne } from '@/lib/medic-assist/contrats'
import { transactionLectureUrl } from './postgres'
import { chiffrerSource, dechiffrerSource } from './secret-source'
import { configurationFichier, jeuSchema } from './configuration'

export const FrequenceSchema = z.coerce.number().int().min(1).max(10080)
export const CleImportSchema = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/)
export const IdSourceSchema = z.string().regex(/^source_[0-9a-f]{32}$/)
const nomSql = z.string().min(1).refine(s => !s.includes('\0') && Buffer.byteLength(s) <= 63)
const titre = z.string().trim().min(1).max(120)

const ConnexionSchema = z.strictObject({
  titre,
  hote: z.string().trim().min(1).max(253).regex(/^(?:[a-z0-9][a-z0-9.-]*|\[[a-f0-9:.]+\])$/i),
  port: z.coerce.number().int().min(1).max(65535),
  base: nomSql,
  utilisateur: nomSql,
  motDePasse: z.string().max(1024),
  tls: z.enum(['require', 'disable']),
})

export const TableSchema = z.strictObject({ schema: nomSql, table: nomSql })
export const ImportSchema = TableSchema.extend({
  sourceId: IdSourceSchema,
  titre,
  description: z.string().trim().max(300),
  colonnes: z.array(nomSql).min(1).max(50),
  frequenceMinutes: FrequenceSchema,
})

export class ErreurAdministrationSource extends Error {}

function prefixe(nom: string, defaut: string) {
  const cle = nom.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(cle) ? cle : defaut + (cle ? '_' + cle : '')
}

type Source = { id: string; titre: string; hote: string; base: string }
type Table = z.infer<typeof TableSchema>
type Colonne = { nom: string; typePostgres: string; type: TypeColonne }

export async function listerSources(): Promise<Source[]> {
  return prisma.$queryRaw`SELECT id, titre, hote, base FROM warehouse.sources ORDER BY titre, id`
}

export async function trouverSource(id: string): Promise<Source | null> {
  const [source] = await prisma.$queryRaw<Source[]>`SELECT id, titre, hote, base FROM warehouse.sources WHERE id = ${id}`
  return source ?? null
}

export async function urlSource(id: string) {
  const [source] = await prisma.$queryRaw<{ secret: string }[]>`SELECT secret FROM warehouse.sources WHERE id = ${id}`
  if (!source) throw new ErreurAdministrationSource('Source introuvable.')
  return dechiffrerSource(id, source.secret)
}

export async function ajouterSource(entree: unknown) {
  const { titre, hote, port, base, utilisateur, motDePasse, tls } = ConnexionSchema.parse(entree)
  const url = new URL('postgresql://' + hote + ':' + port)
  // URL.username/password préservent les séquences % existantes. Encoder explicitement.
  url.username = encodeURIComponent(utilisateur)
  url.password = encodeURIComponent(motDePasse)
  url.pathname = '/' + encodeURIComponent(base)
  url.searchParams.set('sslmode', tls)
  if (tls === 'require') url.searchParams.set('sslaccept', 'strict')
  url.searchParams.set('connect_timeout', '5')
  url.searchParams.set('pool_timeout', '5')
  url.searchParams.set('connection_limit', '1')

  const id = 'source_' + randomUUID().replaceAll('-', '')
  const secret = chiffrerSource(id, url.href)
  await transactionLectureUrl(url.href, async () => undefined)
  await prisma.$executeRaw`
    INSERT INTO warehouse.sources (id, titre, hote, base, secret)
    VALUES (${id}, ${titre}, ${hote + ':' + port}, ${base}, ${secret})
  `
  return id
}

export async function listerTables(id: string, recherche = '') {
  const filtre = '%' + recherche.slice(0, 120).replace(/[\\%_]/g, c => '\\' + c) + '%'
  const tables = await transactionLectureUrl(await urlSource(id), tx => tx.$queryRaw<Table[]>`
    SELECT n.nspname::text AS schema, c.relname::text AS "table"
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND left(n.nspname, 3) <> 'pg_'
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
      AND pg_catalog.has_any_column_privilege(c.oid, 'SELECT')
      AND (n.nspname || '.' || c.relname) ILIKE ${filtre}
    ORDER BY n.nspname, c.relname LIMIT 201
  `)
  return { tables: tables.slice(0, 200), tronque: tables.length > 200 }
}

function typeColonne(type: string): TypeColonne {
  if (['int2', 'int4', 'int8'].includes(type)) return 'entier'
  if (['numeric', 'float4', 'float8'].includes(type)) return 'decimal'
  return type === 'date' ? 'date' : 'texte'
}

export async function listerColonnes(id: string, selection: Table) {
  const { schema, table } = TableSchema.parse(selection)
  const lignes = await transactionLectureUrl(await urlSource(id), tx => tx.$queryRaw<{
    nom: string; typePostgres: string; typeBase: string
  }[]>`
    SELECT a.attname::text AS nom,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS "typePostgres",
      CASE WHEN t.typnamespace = 'pg_catalog'::regnamespace THEN t.typname::text ELSE '' END AS "typeBase"
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    WHERE n.nspname = ${schema} AND c.relname = ${table} AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND left(n.nspname, 3) <> 'pg_'
      AND a.attnum > 0 AND NOT a.attisdropped
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
      AND pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT')
    ORDER BY a.attnum
  `)
  return lignes.map(({ nom, typePostgres, typeBase }): Colonne => ({ nom, typePostgres, type: typeColonne(typeBase) }))
}

export async function creerImport(entree: unknown) {
  const { sourceId, schema, table, titre, description, colonnes, frequenceMinutes } = ImportSchema.parse(entree)
  const disponibles = await listerColonnes(sourceId, { schema, table })
  const parNom = new Map(disponibles.map(c => [c.nom, c]))
  const noms = new Set<string>()
  if (new Set(colonnes).size !== colonnes.length) throw new ErreurAdministrationSource('Une colonne a été sélectionnée deux fois.')
  const projection = colonnes.map(origine => {
    const colonne = parNom.get(origine)
    if (!colonne) throw new ErreurAdministrationSource('Une colonne sélectionnée n’est plus accessible.')
    const base = prefixe(origine, 'colonne').slice(0, 54)
    let nom = base
    for (let i = 2; noms.has(nom); i++) nom = base + '_' + i
    noms.add(nom)
    return { nom, origine, type: colonne.type, description: origine }
  })
  const cle = prefixe(titre, 'jeu').slice(0, 41) + '_' + randomUUID().replaceAll('-', '').slice(0, 16)
  const { frequenceMinutes: frequence, ...definition } = jeuSchema.parse({
    cle, titre, description: description || 'Données de ' + titre, grain: 'Une ligne par enregistrement source',
    schema, table, frequenceMinutes, colonnes: projection,
    dimensions: projection.slice(0, 30).map(c => c.nom), mesures: [],
  })
  const fichier = configurationFichier()
  if (fichier.jeux.some(e => e.jeu.cle === cle) || fichier.combinaisons.some(e => e.cle === cle)) {
    throw new ErreurAdministrationSource('Ce nom de jeu est déjà utilisé. Réessayez.')
  }
  await prisma.$executeRaw`
    INSERT INTO warehouse.imports (cle, source_id, definition, frequence_minutes)
    VALUES (${cle}, ${sourceId}, ${JSON.stringify(definition)}::jsonb, ${frequence})
  `
  return cle
}

export async function modifierFrequence(cle: string, valeur: unknown) {
  const frequence = FrequenceSchema.parse(valeur)
  const nombre = await prisma.$executeRaw(Prisma.sql`
    UPDATE warehouse.imports SET frequence_minutes = ${frequence} WHERE cle = ${CleImportSchema.parse(cle)}
  `)
  if (!nombre) throw new ErreurAdministrationSource('Import introuvable.')
}
