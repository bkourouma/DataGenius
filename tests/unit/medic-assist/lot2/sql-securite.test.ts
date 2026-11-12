/**
 * SQL controle (`requete_sql`) : batterie d'ATTAQUES. Chaque requete doit etre REFUSEE par
 * `analyserSql` (pur, sans base), avec un message court et exploitable, sans fuite (ni schema
 * reel, ni trace, ni chaine de connexion, ni message brut du parseur).
 */

import { describe, expect, it } from 'vitest';

import { analyserSql } from '@/lib/medic-assist/donnees/sql/analyseur';
import { controlerLexique } from '@/lib/medic-assist/donnees/sql/lexique';

const VUES = ['mv_ventes', 'mv_budget', 'mv_pays', 'mv_produits'];

/** Indices de fuite : rien de cela ne doit apparaitre dans un message destine au modele. */
const FUITES: RegExp[] = [
  /postgres(ql)?:\/\//i,
  /node_modules/i,
  /\bat .+\.(js|ts):\d+/,
  /prisma/i,
  /mfa/i,
  /audit_logs/,
  /parametres_application/,
  /Expected .* but/, // message brut du parseur
  /\[object Object\]/,
  /undefined/,
];

function refuse(sql: string): string {
  const r = analyserSql(sql, VUES);
  if (r.ok) throw new Error(`Accepte a tort : ${sql}\n-> ${r.sqlNormalise}`);
  expect(r.message.length).toBeGreaterThan(10);
  expect(r.message.length).toBeLessThan(600);
  for (const motif of FUITES) expect(r.message).not.toMatch(motif);
  return r.message;
}

const NEUF_NIVEAUX = Array.from({ length: 9 }).reduce<string>(
  sql => `SELECT * FROM (${sql}) t`,
  'SELECT pays FROM mv_pays'
);
const ONZE_CTE =
  'WITH ' +
  Array.from({ length: 11 }, (_, i) => `c${i} AS (SELECT pays FROM mv_pays)`).join(', ') +
  ' SELECT * FROM c0';

/** [titre, sql, motif attendu dans le message (exploitable)] */
const ATTAQUES: [string, string, RegExp][] = [
  // Injections classiques et requetes empilees
  ["injection ' OR 1=1 --", "SELECT * FROM mv_ventes WHERE pays = '' OR 1=1 --'", /Commentaires/],
  [
    'requetes empilees ; DROP',
    'SELECT 1 FROM mv_ventes; DROP TABLE users',
    /Une seule instruction|Commande interdite/,
  ],
  ['requetes empilees ; SELECT', 'SELECT 1; SELECT 2', /Une seule instruction/],
  ["point-virgule suivi d'une chaine", "SELECT 1 FROM mv_ventes; 'x'", /Une seule instruction/],
  [
    'point-virgule suivi d un identifiant cite',
    'SELECT 1 FROM mv_ventes; "x"',
    /Une seule instruction/,
  ],
  ['deux points-virgules', 'SELECT 1 FROM mv_ventes;;', /Une seule instruction/],
  [
    'point-virgule suivi d un commentaire',
    'SELECT 1 FROM mv_ventes; -- fin',
    /Une seule instruction|Commentaires/,
  ],
  ['commentaire bloc', 'SELECT /* x */ pays FROM mv_ventes', /Commentaires/],
  ['commentaire bloc imbrique', 'SELECT pays FROM mv_ventes /* a /* b */ c */', /Commentaires/],
  // Tables reelles et catalogue systeme
  [
    'sous-requete vers users',
    'SELECT pays FROM mv_ventes WHERE pays_id IN (SELECT id FROM users)',
    /Table non autorisée : users\. Vues disponibles : mv_budget/,
  ],
  ['users entre guillemets', 'SELECT * FROM "users"', /Table non autorisée : users/],
  ['USERS en majuscules', 'SELECT * FROM USERS', /Table non autorisée : users/],
  ['"USERS" entre guillemets en majuscules', 'SELECT * FROM "USERS"', /guillemets ambigu/],
  ['public.users', 'SELECT * FROM public.users', /schéma interdite/],
  ['pg_catalog.pg_shadow', 'SELECT * FROM pg_catalog.pg_shadow', /système interdit/],
  ['information_schema.tables', 'SELECT * FROM information_schema.tables', /système interdit/],
  ['pg_authid', 'SELECT rolpassword FROM pg_authid', /système interdit/],
  [
    'pg_user via EXISTS',
    'SELECT 1 FROM mv_pays WHERE EXISTS (SELECT 1 FROM pg_user)',
    /système interdit/,
  ],
  [
    'mot de passe en sous-requete scalaire',
    'SELECT pays FROM mv_ventes WHERE pays = (SELECT password FROM users LIMIT 1)',
    /Table non autorisée : users/,
  ],
  ['colonne a trois parties', 'SELECT public.users.password FROM mv_ventes', /schéma interdite/],
  [
    'LATERAL vers table interdite',
    'SELECT * FROM mv_ventes v, LATERAL (SELECT * FROM users) u',
    /Table non autorisée : users/,
  ],
  [
    'UNION vers users',
    'SELECT pays FROM mv_ventes UNION ALL SELECT email FROM users',
    /Table non autorisée : users/,
  ],
  [
    'ANY sur users',
    'SELECT pays FROM mv_pays WHERE pays_id = ANY (SELECT id FROM users)',
    /Table non autorisée : users/,
  ],
  [
    'jointure entre parentheses vers users (angle mort de tableList)',
    'SELECT * FROM (mv_ventes v JOIN users u ON true)',
    /Table non autorisée : users/,
  ],
  ['TABLE users', 'TABLE users', /TABLE/],
  ['FROM ONLY users', 'SELECT * FROM ONLY users', /ONLY/],
  ['espaces et tabulations', 'SELECT\n*\nFROM\tusers', /Table non autorisée : users/],
  ['homoglyphe cyrillique dans le nom de vue', 'SELECT * FROM mv_ventеs', /non ASCII/],
  // Masquage par alias ou par CTE
  ['alias qui masque une vue', 'SELECT * FROM users AS mv_ventes', /Table non autorisée : users/],
  [
    'CTE nommee users',
    'WITH users AS (SELECT pays FROM mv_pays) SELECT * FROM users',
    /Nom de CTE non autorisé : users/,
  ],
  [
    'CTE qui masque une vue mv_*',
    'WITH mv_ventes AS (SELECT 1 AS x) SELECT * FROM mv_ventes',
    /Nom de CTE non autorisé : mv_ventes/,
  ],
  [
    'CTE lisant une CTE definie APRES elle (resolue en table reelle par Postgres)',
    'WITH a AS (SELECT * FROM agencies), agencies AS (SELECT 1 AS x) SELECT * FROM a',
    /Table non autorisée : agencies|Nom de CTE non autorisé/,
  ],
  [
    'CTE en avant sans nom reserve',
    'WITH a AS (SELECT * FROM b), b AS (SELECT 1 AS x) SELECT * FROM a',
    /Table non autorisée : b/,
  ],
  [
    'WITH imbrique dans une sous-requete',
    'SELECT * FROM (WITH x AS (SELECT 1 AS n) SELECT * FROM x) s',
    /WITH permis seulement en tête/,
  ],
  // Ecriture et autres commandes
  ['INSERT direct', "INSERT INTO users (email) VALUES ('a@b.c')", /Commande interdite : INSERT/],
  ['UPDATE direct', "UPDATE users SET password = 'x'", /Commande interdite : UPDATE/],
  ['DELETE direct', 'DELETE FROM users', /Commande interdite : DELETE/],
  ['DROP', 'DROP TABLE users', /Commande interdite : DROP/],
  ['TRUNCATE', 'TRUNCATE audit_logs', /Commande interdite : TRUNCATE/],
  ['COPY vers un fichier', "COPY users TO '/tmp/u.csv'", /Commande interdite : COPY/],
  ['CREATE', 'CREATE TABLE t (id int)', /Commande interdite : CREATE/],
  ['ALTER', 'ALTER TABLE users ADD COLUMN x int', /Commande interdite : ALTER/],
  ['GRANT', 'GRANT ALL ON users TO public', /Commande interdite : GRANT/],
  [
    'INSERT cache dans une CTE',
    'WITH a AS (INSERT INTO users(x) VALUES (1) RETURNING *) SELECT * FROM a',
    /Commande interdite : INSERT/,
  ],
  [
    'DELETE cache dans une CTE',
    'WITH a AS (DELETE FROM mv_ventes RETURNING *) SELECT * FROM a',
    /Commande interdite : DELETE/,
  ],
  ['SELECT INTO', 'SELECT * INTO copie FROM mv_ventes', /INTO interdit/],
  ['FOR UPDATE', 'SELECT * FROM mv_ventes FOR UPDATE', /FOR UPDATE/],
  ['FOR SHARE', 'SELECT * FROM mv_ventes FOR SHARE', /FOR UPDATE/],
  [
    'SET pour sortir de la transaction',
    'SET transaction_read_only = off',
    /Commande interdite : SET/,
  ],
  ['RESET', 'RESET ALL', /Commande interdite : RESET/],
  ['BEGIN', 'BEGIN', /Commande interdite : BEGIN/],
  ['COMMIT puis ecriture', 'COMMIT; DELETE FROM users', /Commande interdite/],
  ['ROLLBACK', 'ROLLBACK', /Commande interdite : ROLLBACK/],
  ['EXPLAIN ANALYZE', 'EXPLAIN ANALYZE SELECT * FROM mv_ventes', /Commande interdite : EXPLAIN/],
  ['DO $$', 'DO $$ BEGIN PERFORM pg_sleep(10); END $$', /Commande interdite : DO|\$/],
  ['CALL', 'CALL purge()', /Commande interdite : CALL/],
  ['VACUUM', 'VACUUM users', /Commande interdite : VACUUM/],
  ['LISTEN / NOTIFY', "NOTIFY canal, 'x'", /Commande interdite : NOTIFY/],
  // Fonctions dangereuses
  ['pg_sleep', 'SELECT pg_sleep(10)', /système interdit/],
  ['PG_SLEEP en majuscules', 'SELECT PG_SLEEP(10) FROM mv_ventes', /système interdit/],
  ['"pg_sleep" entre guillemets', 'SELECT "pg_sleep"(10)', /Nom interdit/],
  ['pg_read_file', "SELECT pg_read_file('/etc/passwd')", /système interdit/],
  ['lo_import', "SELECT lo_import('/etc/passwd')", /système interdit/],
  ['dblink', "SELECT * FROM dblink('host=x', 'SELECT 1') AS t(a int)", /système interdit/],
  ['current_setting', "SELECT current_setting('data_directory')", /système interdit/],
  ['set_config', "SELECT set_config('search_path', 'pg_catalog', true)", /système interdit/],
  // Sortie du role medic_assist_lecture : sous SET LOCAL ROLE, la session reste celle du compte
  // de connexion (superutilisateur), et seul l'analyseur empeche d'y revenir.
  ['set_config du role', "SELECT set_config('role', 'none', true)", /système interdit : set_config/],
  [
    'set_config du role sur une vue',
    "SELECT set_config('role', 'postgres', false) AS r FROM mv_ventes",
    /système interdit : set_config/,
  ],
  ['SET ROLE', 'SET ROLE postgres', /Commande interdite : SET/],
  ['SET LOCAL ROLE', 'SET LOCAL ROLE NONE', /Commande interdite : SET/],
  ['RESET ROLE', 'RESET ROLE', /Commande interdite : RESET/],
  ['SET SESSION AUTHORIZATION', 'SET SESSION AUTHORIZATION postgres', /Commande interdite : SET/],
  [
    'SET ROLE apres un SELECT',
    'SELECT pays FROM mv_ventes; SET ROLE NONE',
    /Une seule instruction SELECT/,
  ],
  ['version()', 'SELECT version()', /système interdit/],
  ['current_database()', 'SELECT current_database()', /système interdit/],
  ['current_user', 'SELECT current_user', /système interdit/],
  [
    'user (mot-cle pris pour une colonne par le parseur)',
    'SELECT user FROM mv_ventes',
    /système interdit/,
  ],
  ['session_user', 'SELECT session_user', /système interdit/],
  ["'pg_authid'::regclass", "SELECT 'pg_authid'::regclass", /système interdit/],
  ['CAST(... AS regproc)', "SELECT CAST('now' AS regproc)", /système interdit/],
  ['to_regclass', "SELECT to_regclass('users')", /Fonction non autorisée : to_regclass/],
  [
    'query_to_xml',
    "SELECT query_to_xml('SELECT * FROM users', true, true, '')",
    /système interdit/,
  ],
  ['txid_current', 'SELECT txid_current()', /système interdit/],
  ['inet_server_addr', 'SELECT inet_server_addr()', /système interdit/],
  ['nextval', "SELECT nextval('seq')", /système interdit/],
  [
    'fonction inconnue',
    'SELECT ma_fonction(ca_eur) FROM mv_ventes',
    /Fonction non autorisée : ma_fonction\. Fonctions permises/,
  ],
  [
    'fonction qualifiee par un schema',
    'SELECT public.sum(ca_eur) FROM mv_ventes',
    /schéma interdite/,
  ],
  ['VALUES + fonction interdite', 'SELECT * FROM (VALUES (pg_sleep(5))) t', /système interdit/],
  [
    'VALUES + fonction inconnue',
    "SELECT * FROM (VALUES (repeat('x', 100000000))) t",
    /Fonction non autorisée : repeat/,
  ],
  ['generate_series(1, 1e12)', 'SELECT generate_series(1, 1e12)', /generate_series/],
  [
    'generate_series non litterale',
    'SELECT * FROM generate_series(1, (SELECT MAX(quantite) FROM mv_ventes)) g',
    /generate_series/,
  ],
  ['lpad geant', "SELECT lpad('x', 1000000000) FROM mv_ventes", /lpad : la longueur/],
  [
    'cast vers un type non permis (cast cast cast)',
    "SELECT '1'::money FROM mv_ventes",
    /Cast vers money interdit/,
  ],
  [
    'expression reguliere (ReDoS)',
    "SELECT pays FROM mv_pays WHERE pays ~ '(a+)+$'",
    /Opérateur non autorisé/,
  ],
  [
    'WITH RECURSIVE',
    'WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM r) SELECT * FROM r',
    /WITH RECURSIVE/,
  ],
  // Chaines et caracteres qui font diverger parseur et Postgres
  ['dollar-quoting $$', 'SELECT $$abc$$ FROM mv_ventes', /\$/],
  ['dollar-quoting $tag$', "SELECT $t$x'$t$ FROM mv_ventes", /\$/],
  ['parametre $1', 'SELECT * FROM mv_ventes WHERE pays_id = $1', /\$/],
  ["E'\\x27'", "SELECT E'\\x27' FROM mv_ventes", /Chaînes préfixées/],
  ["U&'...'", "SELECT U&'\\0041' FROM mv_ventes", /Chaînes préfixées/],
  ['antislash dans une chaine', "SELECT 'a\\' FROM mv_ventes", /Antislash/],
  ['caractere NUL', 'SELECT pays FROM mv_pays\u0000; DROP TABLE users', /NUL/],
  ['chaine non fermee', "SELECT 'abc FROM mv_ventes", /Chaîne non fermée/],
  // Taille et complexite
  [
    'requete trop longue',
    'SELECT pays FROM mv_ventes WHERE ' + 'quantite = 1 OR '.repeat(700) + 'true',
    /trop longue/,
  ],
  ['sous-requetes trop imbriquees', NEUF_NIVEAUX, /trop imbriquées/],
  ['trop de CTE', ONZE_CTE, /Trop de CTE/],
  [
    'alias avec liste de colonnes (rendu fautif du parseur)',
    'SELECT * FROM (VALUES (1, 2)) AS t(a, b)',
    /Alias non pris en charge/,
  ],
];

describe('requete_sql : attaques refusees', () => {
  it('la batterie compte au moins 25 cas', () => {
    expect(ATTAQUES.length).toBeGreaterThanOrEqual(25);
  });

  for (const [titre, sql, attendu] of ATTAQUES) {
    it(titre, () => {
      const message = refuse(sql);
      expect(message).toMatch(attendu);
    });
  }
});

/** Une reference a users, cachee dans chaque position syntaxique possible : toujours refusee. */
const POSITIONS: string[] = [
  "SELECT (SELECT string_agg(email, ',') FROM users) AS e",
  'SELECT * FROM ((SELECT 1 AS a) UNION (SELECT id FROM users)) t',
  'SELECT * FROM mv_ventes, (users)',
  'SELECT * FROM mv_ventes JOIN users USING (id)',
  'SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM users)) AS n FROM mv_ventes',
  'SELECT 1 AS a FROM mv_ventes WHERE NOT EXISTS (SELECT 1 FROM users)',
  'SELECT sum(ca_eur) OVER (PARTITION BY (SELECT 1 FROM users)) AS s FROM mv_ventes',
  'SELECT * FROM mv_ventes ORDER BY (SELECT 1 FROM users)',
  'SELECT pays FROM mv_ventes GROUP BY (SELECT 1 FROM users)',
  'SELECT pays FROM mv_ventes GROUP BY pays HAVING count(*) > (SELECT count(*) FROM users)',
  'SELECT * FROM mv_ventes LIMIT (SELECT 1 FROM users)',
  'SELECT CASE WHEN true THEN (SELECT 1 FROM users) END AS c',
  'SELECT * FROM generate_series(1, 3) g JOIN users ON true',
  'SELECT * FROM (VALUES ((SELECT 1 FROM users))) t',
  'SELECT extract(year from (SELECT now() FROM users)) AS a',
  'SELECT string_agg(pays, (SELECT email FROM users)) AS s FROM mv_ventes',
  'SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (SELECT 1 FROM users)) AS p FROM mv_ventes',
  'SELECT lag(ca_eur, 1, (SELECT 1 FROM users)) OVER () AS l FROM mv_ventes',
  'SELECT DISTINCT ON ((SELECT 1 FROM users)) pays FROM mv_ventes',
  'SELECT pays FROM mv_ventes WINDOW w AS (PARTITION BY (SELECT 1 FROM users))',
  'WITH a(x) AS (SELECT 1) SELECT * FROM a, users',
  'SELECT * FROM mv_ventes v JOIN mv_pays p ON p.pays_id = (SELECT id FROM users LIMIT 1)',
  'SELECT cast((SELECT 1 FROM users) AS int) AS c',
  'SELECT coalesce(pays, (SELECT email FROM users LIMIT 1)) AS c FROM mv_ventes',
  'SELECT * FROM mv_ventes WHERE (pays, ca_eur) IN (SELECT email, 1 FROM users)',
  'SELECT * FROM mv_ventes WHERE ca_eur > ALL (SELECT 1 FROM users)',
  'SELECT -(SELECT 1 FROM users) AS a',
  "SELECT interval '1 day' * (SELECT 1 FROM users) AS a",
  'WITH a AS (SELECT 1 AS x) SELECT * FROM a WHERE x IN (WITH b AS (SELECT 1) SELECT * FROM users)',
];

describe('requete_sql : users dans chaque position syntaxique', () => {
  for (const sql of POSITIONS) {
    it(sql, () => {
      refuse(sql);
    });
  }
});

describe('requete_sql : filet lexical', () => {
  it('normalise la casse hors chaines et garde les chaines intactes', () => {
    const r = controlerLexique("SELECT Pays FROM MV_Ventes WHERE pays = 'Côte d''Ivoire';");
    expect(r).toEqual({
      ok: true,
      texte: "select pays from mv_ventes where pays = 'Côte d''Ivoire'",
    });
  });

  it('accepte -- et /* */ a l interieur d une chaine', () => {
    expect(controlerLexique("SELECT 'a--b /* c */' AS t").ok).toBe(true);
  });

  it('refuse un mot interdit meme dans un alias', () => {
    expect(controlerLexique('SELECT 1 AS delete').ok).toBe(false);
  });

  it('sans aucune vue autorisee, le message le dit', () => {
    const r = analyserSql('SELECT * FROM mv_ventes', []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/aucune vue disponible/);
  });

  it('une vue absente de la liste autorisee est refusee', () => {
    const r = analyserSql('SELECT * FROM mv_stocks', VUES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Table non autorisée : mv_stocks/);
  });

  it('une syntaxe non reconnue donne un conseil, pas le message brut du parseur', () => {
    const message = refuse('SELECT substring(pays from 1 for 3) FROM mv_pays');
    expect(message).toMatch(/Syntaxe SQL non reconnue|SUBSTRING/);
  });
});
