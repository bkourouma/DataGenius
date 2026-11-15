import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'

const MYSQL_ROOT_PASSWORD = randomBytes(24).toString('hex')
const motDePasse = randomBytes(24).toString('hex')
const nom = 'datagenius-mysql-recette-' + randomUUID()
const env = { ...process.env, MYSQL_ROOT_PASSWORD, MYSQL_PWD: MYSQL_ROOT_PASSWORD }
let conteneur

function docker(args, options = {}) {
  const resultat = spawnSync('docker', args, { encoding: 'utf8', env, ...options })
  if (resultat.error) throw resultat.error
  if (resultat.status !== 0) throw new Error(`Docker ${args[0]} a échoué. ${resultat.stderr?.trim() ?? ''}`)
  return resultat.stdout.trim()
}

try {
  conteneur = docker(['run', '--rm', '--detach', '--name', nom, '--env', 'MYSQL_ROOT_PASSWORD', '--publish', '127.0.0.1::3306', 'mysql:8.4'])
  const mysql = ['exec', '-i', '--env', 'MYSQL_PWD', conteneur, 'mysql', '-uroot', '--protocol=socket', '--batch']
  let pret = false
  for (let attente = 0; attente < 90; attente++) {
    if (spawnSync('docker', [...mysql, '-e', 'SELECT 1'], { stdio: 'ignore', env }).status === 0) {
      // Le serveur provisoire d’initialisation répond sur le socket, mais pas en TCP.
      const processus = docker(['exec', conteneur, 'cat', '/proc/1/comm'])
      if (processus === 'mysqld') { pret = true; break }
    }
    await setTimeout(1000)
  }
  if (!pret) throw new Error('MySQL n’a pas démarré dans les 90 secondes.')
  const fixture = readFileSync(new URL('../tests/fixtures/mysql.sql', import.meta.url), 'utf8')
  docker(mysql, { input: `${fixture}\nCREATE USER 'dg_mysql_reader'@'%' IDENTIFIED BY '${motDePasse}';
    GRANT SELECT ON dg_source_mysql.ventes TO 'dg_mysql_reader'@'%';` })
  const adresse = docker(['port', conteneur, '3306/tcp'])
  if (!/^127\.0\.0\.1:\d+$/.test(adresse)) throw new Error('Port de recette MySQL indisponible.')
  const DATAGENIUS_TEST_MYSQL_URL = `mysql://dg_mysql_reader:${motDePasse}@${adresse}/dg_source_mysql`
  const npm = process.env.npm_execpath
  if (!npm) throw new Error('Lancez cette recette via npm run test:mysql.')
  const resultat = spawnSync(process.execPath, [npm, 'run', 'test:postgres', '--', 'tests/integration/connecteurs.test.ts'], {
    stdio: 'inherit', env: { ...process.env, DATAGENIUS_TEST_MYSQL_URL, DATAGENIUS_SOURCES_HOTES_AUTORISES: '127.0.0.1' },
  })
  if (resultat.error) throw resultat.error
  process.exitCode = resultat.status ?? 1
} catch (erreur) {
  console.error(erreur.message)
  process.exitCode = 1
} finally {
  if (conteneur && /^[a-f0-9]{64}$/.test(conteneur)) {
    try { docker(['stop', conteneur]) } catch (erreur) { console.error(erreur.message); process.exitCode = 1 }
  }
}
