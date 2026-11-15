import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import type { TypeColonne } from '@/lib/medic-assist/contrats'
import { transactionLectureUrl } from './postgres'
import { chiffrerSource, dechiffrerSource } from './secret-source'
import { configurationFichier, jeuSchema, type JeuConfigure, type TypeSource } from './configuration'
import { ConnexionMySql, mysql, testerMySql } from './connecteurs/mysql'
import { ConnexionRest, rest, testerRest } from './connecteurs/rest'
import { fichier, testerFichier, type ConfigurationFichier } from './connecteurs/fichier'
import { verifierHoteSource } from './hotes-sources'
import { auditerSuppression, dependancesJeuAvec, listeTitres, purgerDonneesJeu, verrouillerJeux, verrouillerSynchroJeu } from './jeux-admin'

export { dependancesJeu, type DependancesJeu } from './jeux-admin'

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

type Source = { id: string; titre: string; hote: string; base: string; type: TypeSource }
type Table = z.infer<typeof TableSchema>
type Colonne = { nom: string; typePostgres: string; type: TypeColonne }

export async function listerSources(): Promise<Source[]> {
  return prisma.$queryRaw`SELECT id, titre, hote, base, type FROM warehouse.sources ORDER BY titre, id`
}

export async function trouverSource(id: string): Promise<Source | null> {
  const [source] = await prisma.$queryRaw<Source[]>`SELECT id, titre, hote, base, type FROM warehouse.sources WHERE id = ${id}`
  return source ?? null
}

async function secretSource(id: string) {
  const [source] = await prisma.$queryRaw<{ secret: string }[]>`SELECT secret FROM warehouse.sources WHERE id = ${id}`
  if (!source) throw new ErreurAdministrationSource('Source introuvable.')
  return dechiffrerSource(id, source.secret)
}

export async function urlSource(id: string) {
  const secret = await secretSource(id)
  if (secret.startsWith('postgres')) await verifierHoteSource(new URL(secret).hostname)
  return secret
}

type ConnexionPostgres = z.infer<typeof ConnexionSchema>

function urlPostgres({ hote, port, base, utilisateur, motDePasse, tls }: ConnexionPostgres) {
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
  return url
}

export async function ajouterSource(entree: unknown) {
  const { titre, hote, port, base, utilisateur, motDePasse, tls } = ConnexionSchema.parse(entree)
  const url = urlPostgres({ titre, hote, port, base, utilisateur, motDePasse, tls })
  await verifierHoteSource(url.hostname)

  const id = 'source_' + randomUUID().replaceAll('-', '')
  const secret = chiffrerSource(id, url.href)
  await transactionLectureUrl(url.href, async () => undefined)
  await prisma.$executeRaw`
    INSERT INTO warehouse.sources (id, titre, hote, base, secret)
    VALUES (${id}, ${titre}, ${hote + ':' + port}, ${base}, ${secret})
  `
  return id
}

export async function ajouterSourceMySql(nom: unknown, entree: unknown) {
  const libelle = titre.parse(nom)
  const config = ConnexionMySql.parse(entree)
  await testerMySql(config)
  const id = 'source_' + randomUUID().replaceAll('-', '')
  const secret = chiffrerSource(id, JSON.stringify(config))
  await prisma.$executeRaw`
    INSERT INTO warehouse.sources (id, titre, hote, base, secret, type)
    VALUES (${id}, ${libelle}, ${config.hote + ':' + config.port}, ${config.base}, ${secret}, 'mysql')
  `
  return id
}

export async function ajouterSourceRest(nom: unknown, entree: unknown) {
  const libelle = titre.parse(nom)
  const config = ConnexionRest.parse(entree)
  await testerRest(config)
  const id = 'source_' + randomUUID().replaceAll('-', '')
  const secret = chiffrerSource(id, JSON.stringify(config))
  await prisma.$executeRaw`
    INSERT INTO warehouse.sources (id, titre, hote, base, secret, type)
    VALUES (${id}, ${libelle}, ${new URL(config.url).host}, 'API REST', ${secret}, 'rest')
  `
  return id
}

export async function ajouterSourceFichier(nom: unknown, config: ConfigurationFichier) {
  const libelle = titre.parse(nom)
  await testerFichier(config)
  const id = 'source_' + randomUUID().replaceAll('-', '')
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`
      INSERT INTO warehouse.sources (id, titre, hote, base, secret, type)
      VALUES (${id}, ${libelle}, 'Fichier local', ${config.nom}, '', 'fichier')
    `
    await tx.$executeRaw`
      INSERT INTO warehouse.source_fichiers (source_id, nom, contenu)
      VALUES (${id}, ${config.nom}, ${config.contenu})
    `
  })
  return id
}

export async function remplacerSourceFichier(idBrut: unknown, config: ConfigurationFichier) {
  const id = IdSourceSchema.parse(idBrut)
  await testerFichier(config)
  await prisma.$transaction(async tx => {
    const nombre = await tx.$executeRaw`UPDATE warehouse.sources SET base = ${config.nom} WHERE id = ${id} AND type = 'fichier'`
    if (!nombre) throw new ErreurAdministrationSource('Source fichier introuvable.')
    await tx.$executeRaw`UPDATE warehouse.source_fichiers SET nom = ${config.nom}, contenu = ${config.contenu} WHERE source_id = ${id}`
  })
}

async function chargerFichier(id: string) {
  const [config] = await prisma.$queryRaw<ConfigurationFichier[]>`SELECT nom, contenu FROM warehouse.source_fichiers WHERE source_id = ${id}`
  if (!config) throw new ErreurAdministrationSource('Fichier introuvable.')
  return config
}

async function typeSource(id: string) {
  const source = await trouverSource(id)
  if (!source) throw new ErreurAdministrationSource('Source introuvable.')
  return source.type
}

async function configMySql(id: string) { return ConnexionMySql.parse(JSON.parse(await urlSource(id))) }
async function configRest(id: string) { return ConnexionRest.parse(JSON.parse(await urlSource(id))) }

export async function lireSourceExterne(id: string, type: Exclude<TypeSource, 'postgresql'>, jeu: JeuConfigure) {
  switch (type) {
    case 'mysql': return mysql.lire(await configMySql(id), jeu)
    case 'rest': return rest.lire(await configRest(id), jeu)
    case 'fichier': return fichier.lire(await chargerFichier(id), jeu)
  }
}

export async function listerTables(id: string, recherche = '') {
  switch (await typeSource(id)) {
    case 'mysql': return mysql.tables(await configMySql(id), recherche)
    case 'rest': return rest.tables(await configRest(id), recherche)
    case 'fichier': return fichier.tables(await chargerFichier(id), recherche)
  }
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
  switch (await typeSource(id)) {
    case 'mysql': return mysql.colonnes(await configMySql(id), { schema, table })
    case 'rest': return rest.colonnes(await configRest(id), { schema, table })
    case 'fichier': return fichier.colonnes(await chargerFichier(id), { schema, table })
  }
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

const MessageSecretRequis = 'Ressaisissez le mot de passe ou le jeton : il n’est jamais réutilisé quand la destination de la connexion change.'
const MessageEchecTest = 'La connexion avec ces paramètres a échoué. Rien n’a été modifié.'

function analyser<T extends z.ZodTypeAny>(schema: T, entree: unknown): z.infer<T> {
  const resultat = schema.safeParse(entree)
  if (!resultat.success) throw new ErreurAdministrationSource('Vérifiez les champs du formulaire.')
  return resultat.data
}

const ModificationMySql = ConnexionMySql.extend({ titre })
const ModificationRest = ConnexionRest.extend({ titre })
const ModificationFichier = z.strictObject({ titre })

export async function chargerConnexionSource(idBrut: string) {
  const id = IdSourceSchema.safeParse(idBrut)
  const source = id.success ? await trouverSource(id.data) : null
  if (!source) return null
  const vide = { hote: '', port: '', base: '', utilisateur: '', tls: 'disable' as 'require' | 'disable', url: '', chemin: '', parametrePage: '' }
  const resultat = { type: source.type, titre: source.titre, ...vide, avecSecret: false }
  if (source.type === 'fichier') return resultat
  const secret = await secretSource(source.id)
  if (source.type === 'mysql') {
    const c = ConnexionMySql.parse(JSON.parse(secret))
    return { ...resultat, hote: c.hote, port: String(c.port), base: c.base, utilisateur: c.utilisateur, tls: c.tls, avecSecret: c.motDePasse !== '' }
  }
  if (source.type === 'rest') {
    const c = ConnexionRest.parse(JSON.parse(secret))
    return { ...resultat, url: c.url, chemin: c.chemin, parametrePage: c.parametrePage, avecSecret: c.token !== '' }
  }
  const url = new URL(secret)
  return {
    ...resultat, hote: url.hostname, port: url.port || '5432', base: decodeURIComponent(url.pathname.slice(1)),
    utilisateur: decodeURIComponent(url.username),
    tls: url.searchParams.get('sslmode') === 'require' ? 'require' as const : 'disable' as const,
    avecSecret: url.password !== '',
  }
}

export async function modifierSource(idBrut: unknown, entree: unknown) {
  const id = analyser(IdSourceSchema, idBrut)
  const source = await trouverSource(id)
  if (!source) throw new ErreurAdministrationSource('Source introuvable.')
  if (source.type === 'fichier') {
    const { titre: libelle } = analyser(ModificationFichier, entree)
    await prisma.$executeRaw`UPDATE warehouse.sources SET titre = ${libelle} WHERE id = ${id}`
    return
  }
  const secretActuel = await secretSource(id)
  if (source.type === 'rest') {
    const { titre: libelle, ...saisie } = analyser(ModificationRest, entree)
    const actuelle = ConnexionRest.parse(JSON.parse(secretActuel))
    // Le jeton ne doit pas partir vers une autre origine sans être ressaisi.
    if (!saisie.token && actuelle.token && new URL(saisie.url).origin !== new URL(actuelle.url).origin) {
      throw new ErreurAdministrationSource(MessageSecretRequis)
    }
    const config = ConnexionRest.parse({ ...saisie, token: saisie.token || actuelle.token })
    try { await testerRest(config) } catch { throw new ErreurAdministrationSource(MessageEchecTest) }
    await prisma.$executeRaw`
      UPDATE warehouse.sources SET titre = ${libelle}, hote = ${new URL(config.url).host},
        secret = ${chiffrerSource(id, JSON.stringify(config))}
      WHERE id = ${id}`
    return
  }
  if (source.type === 'mysql') {
    const { titre: libelle, ...saisie } = analyser(ModificationMySql, entree)
    const actuelle = ConnexionMySql.parse(JSON.parse(secretActuel))
    const config = ConnexionMySql.parse({ ...saisie, motDePasse: saisie.motDePasse || actuelle.motDePasse })
    if (!saisie.motDePasse && actuelle.motDePasse && (config.hote.toLowerCase() !== actuelle.hote.toLowerCase() ||
        config.port !== actuelle.port || config.base !== actuelle.base || config.utilisateur !== actuelle.utilisateur)) {
      throw new ErreurAdministrationSource(MessageSecretRequis)
    }
    await verifierHoteSource(config.hote)
    try { await testerMySql(config) } catch { throw new ErreurAdministrationSource(MessageEchecTest) }
    await prisma.$executeRaw`
      UPDATE warehouse.sources SET titre = ${libelle}, hote = ${config.hote + ':' + config.port}, base = ${config.base},
        secret = ${chiffrerSource(id, JSON.stringify(config))}
      WHERE id = ${id}`
    return
  }
  const { motDePasse, ...saisie } = analyser(ConnexionSchema, entree)
  const actuelle = new URL(secretActuel)
  const url = urlPostgres({ ...saisie, motDePasse: motDePasse || decodeURIComponent(actuelle.password) })
  if (!motDePasse && actuelle.password && (url.hostname.toLowerCase() !== actuelle.hostname.toLowerCase() ||
      (url.port || '5432') !== (actuelle.port || '5432') || url.pathname !== actuelle.pathname || url.username !== actuelle.username)) {
    throw new ErreurAdministrationSource(MessageSecretRequis)
  }
  await verifierHoteSource(url.hostname)
  try { await transactionLectureUrl(url.href, async () => undefined) } catch { throw new ErreurAdministrationSource(MessageEchecTest) }
  await prisma.$executeRaw`
    UPDATE warehouse.sources SET titre = ${saisie.titre}, hote = ${saisie.hote + ':' + saisie.port}, base = ${saisie.base},
      secret = ${chiffrerSource(id, url.href)}
    WHERE id = ${id}`
}

export async function dependancesSource(idBrut: string) {
  const id = IdSourceSchema.safeParse(idBrut)
  if (!id.success) return { imports: [] }
  const imports = await prisma.$queryRaw<{ cle: string; titre: string }[]>`
    SELECT cle, COALESCE(definition ->> 'titre', cle) AS titre FROM warehouse.imports WHERE source_id = ${id.data} ORDER BY 2, 1`
  return { imports }
}

export async function supprimerSource(acteur: string, idBrut: string) {
  const id = IdSourceSchema.safeParse(idBrut)
  if (!id.success) throw new ErreurAdministrationSource('Source introuvable.')
  await prisma.$transaction(async tx => {
    const [source] = await tx.$queryRaw<{ titre: string }[]>`SELECT titre FROM warehouse.sources WHERE id = ${id.data} FOR UPDATE`
    if (!source) throw new ErreurAdministrationSource('Source introuvable.')
    const imports = await tx.$queryRaw<{ titre: string }[]>`
      SELECT COALESCE(definition ->> 'titre', cle) AS titre FROM warehouse.imports WHERE source_id = ${id.data} ORDER BY 1`
    if (imports.length) {
      throw new ErreurAdministrationSource('Cette source est utilisée par ' + listeTitres(imports.map(i => i.titre)) + '. Supprimez d’abord ces imports.')
    }
    await tx.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${id.data}`
    await auditerSuppression(tx, acteur, 'Source supprimée', source.titre, false)
  })
}

export async function renommerImport(acteur: string, cle: string, libelle: unknown) {
  const nouveau = analyser(titre, libelle)
  const cleValide = CleImportSchema.safeParse(cle)
  if (!cleValide.success) throw new ErreurAdministrationSource('Import introuvable.')
  await prisma.$transaction(async tx => {
    const nombre = await tx.$executeRaw`
      UPDATE warehouse.imports SET definition = jsonb_set(definition, '{titre}', to_jsonb(${nouveau}::text)) WHERE cle = ${cleValide.data}`
    if (!nombre) throw new ErreurAdministrationSource('Import introuvable.')
    await auditerSuppression(tx, acteur, 'Import renommé', nouveau, false)
  })
}

export async function supprimerImport(acteur: string, cle: string) {
  const cleValide = CleImportSchema.safeParse(cle)
  if (!cleValide.success) throw new ErreurAdministrationSource('Import introuvable.')
  await prisma.$transaction(async tx => {
    await verrouillerSynchroJeu(tx, cleValide.data)
    await verrouillerJeux(tx)
    const [existant] = await tx.$queryRaw<{ titre: string }[]>`
      SELECT COALESCE(definition ->> 'titre', cle) AS titre FROM warehouse.imports WHERE cle = ${cleValide.data} FOR UPDATE`
    if (!existant) throw new ErreurAdministrationSource('Import introuvable.')
    const { combinaisons } = await dependancesJeuAvec(tx, cleValide.data)
    if (combinaisons.length) {
      throw new ErreurAdministrationSource('Cet import est utilisé par ' + listeTitres(combinaisons.map(c => c.titre)) + '. Supprimez d’abord ces jeux combinés.')
    }
    const droits = await purgerDonneesJeu(tx, cleValide.data)
    await tx.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${cleValide.data}`
    await auditerSuppression(tx, acteur, 'Import supprimé', existant.titre, droits)
  }, { timeout: 15_000 })
}
