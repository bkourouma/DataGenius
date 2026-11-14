import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projet = fileURLToPath(new URL('../', import.meta.url))
const racine = realpathSync(tmpdir())
const prefixe = 'datagenius-recette-'
const dossier = realpathSync(mkdtempSync(join(racine, prefixe)))
const cluster = join(dossier, 'cluster')
const journal = join(dossier, 'postgres.log')
const hote = '127.0.0.1'
const administrateur = 'dg_bootstrap'
const motsDePasse = Object.fromEntries([
  administrateur, 'dg_app', 'dg_reader', 'dg_support_reader', 'dg_warehouse_reader',
].map(role => [role, randomBytes(24).toString('hex')]))
const npm = process.env.npm_execpath
let demarrageTente = false

function commande(nom, args, options = {}) {
  const resultat = spawnSync(nom, args, { cwd: projet, stdio: 'inherit', ...options })
  if (resultat.error) throw new Error(`Impossible de lancer ${basename(nom)}.`, { cause: resultat.error })
  if (resultat.status !== 0) throw new Error(`${basename(nom)} a échoué (${resultat.status ?? resultat.signal}).`)
  return resultat.stdout
}

function binaire(nom) {
  const fichier = process.platform === 'win32' ? `${nom}.exe` : nom
  return process.env.PG_BIN ? join(process.env.PG_BIN, fichier) : fichier
}

async function reserverPort() {
  const serveur = createServer()
  return new Promise((resolve, reject) => {
    serveur.once('error', reject)
    serveur.listen(0, hote, () => {
      const { port } = serveur.address()
      serveur.close(erreur => erreur ? reject(erreur) : resolve(port))
    })
  })
}

function appliquerSql(port, base, sql) {
  commande(binaire('psql'), ['-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1', '-h', hote,
    '-p', String(port), '-U', administrateur, '-d', base], {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGPASSWORD: motsDePasse[administrateur] },
  })
}

function executerNpm(args, env) {
  commande(process.execPath, [npm, ...args], { env })
}

try {
  if (!npm) throw new Error('Lancez cette recette avec npm run test:postgres.')
  const port = await reserverPort()
  const fichierMotDePasse = join(dossier, 'initial')
  writeFileSync(fichierMotDePasse, motsDePasse[administrateur] + '\n', { mode: 0o600 })
  commande(binaire('initdb'), ['-D', cluster, '-U', administrateur, '--encoding=UTF8',
    '--locale=C', '--auth=scram-sha-256', `--pwfile=${fichierMotDePasse}`], { stdio: ['ignore', 'ignore', 'inherit'] })
  unlinkSync(fichierMotDePasse)
  demarrageTente = true
  commande(binaire('pg_ctl'), ['-D', cluster, '-l', journal, '-o',
    `-h ${hote} -p ${port} -c unix_socket_directories=`, '-w', 'start'])

  appliquerSql(port, 'postgres', [
    ...Object.entries(motsDePasse).filter(([role]) => role !== administrateur)
      .map(([role, motDePasse]) => `CREATE ROLE ${role} LOGIN PASSWORD '${motDePasse}';`),
    'CREATE DATABASE dg_app OWNER dg_app;',
    'CREATE DATABASE dg_source;',
    'CREATE DATABASE dg_support;',
  ].join('\n'))
  appliquerSql(port, 'dg_source', readFileSync(join(projet, 'tests/fixtures/postgresql.sql'), 'utf8'))
  appliquerSql(port, 'dg_support', readFileSync(join(projet, 'tests/fixtures/postgresql-support.sql'), 'utf8'))

  const url = (role, base) => `postgresql://${role}:${motsDePasse[role]}@${hote}:${port}/${base}?sslmode=disable`
  const env = {
    ...process.env,
    DATABASE_URL: url('dg_app', 'dg_app'),
    DATAGENIUS_WAREHOUSE_READ_URL: url('dg_warehouse_reader', 'dg_app'),
    DATAGENIUS_SOURCE_DISTRIBUTION: url('dg_reader', 'dg_source'),
    DATAGENIUS_SOURCE_SUPPORT: url('dg_support_reader', 'dg_support'),
    DATAGENIUS_TEST_SUPPORT_OWNER_URL: url(administrateur, 'dg_support'),
    DATAGENIUS_CATALOGUE: 'config/demo-postgresql.json',
    DATAGENIUS_SOURCE_KEY: randomBytes(32).toString('hex'),
    // La recette ajoute des sources sur 127.0.0.1 : le filtre d’hôtes les refuserait sinon.
    DATAGENIUS_SOURCES_HOTES_AUTORISES: hote,
    DATAGENIUS_TEST_POSTGRES: '1',
  }
  executerNpm(['run', 'db:deploy'], env)
  appliquerSql(port, 'dg_app', `
    GRANT CONNECT ON DATABASE dg_app TO dg_warehouse_reader;
    GRANT USAGE ON SCHEMA warehouse TO dg_warehouse_reader;
    GRANT SELECT ON warehouse.snapshots TO dg_warehouse_reader;
  `)
  executerNpm(['test', '--', '--project', 'postgresql', '--no-file-parallelism', ...process.argv.slice(2)], env)
} catch (erreur) {
  console.error(erreur.message)
  process.exitCode = 1
} finally {
  const serveurActif = demarrageTente && spawnSync(binaire('pg_ctl'), ['-D', cluster, 'status'], { stdio: 'ignore' }).status === 0
  try {
    if (serveurActif) commande(binaire('pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop'])
    const cible = realpathSync(dossier)
    if (dirname(cible) !== racine || !basename(cible).startsWith(prefixe)) throw new Error('Dossier temporaire inattendu.')
    rmSync(cible, { recursive: true, maxRetries: 5, retryDelay: 200 })
  } catch (erreur) {
    console.error(`Nettoyage de la recette PostgreSQL incomplet (${dossier}). ${erreur.message}`)
    process.exitCode = 1
  }
}
