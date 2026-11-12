/**
 * Listes blanches et listes noires du SQL controle (`requete_sql`, architecture §5).
 *
 * Principe : TOUT ce qui n'est pas explicitement permis ici est refuse (fonctions, types de
 * cast, operateurs, champs d'EXTRACT, mots-cles « origin » du parseur). Les listes noires ne
 * servent que de filet lexical, en secours de l'analyse de l'arbre.
 */

/** Longueur maximale du SQL de l'IA (caracteres). */
export const LONGUEUR_MAX_SQL = 10_000
/** Nombre maximal de CTE ecrites par l'IA. */
export const MAX_CTE = 10
/** Profondeur maximale d'imbrication des sous-requetes. */
export const MAX_PROFONDEUR = 6
/** Nombre maximal de SELECT dans la requete (CTE, sous-requetes, branches d'UNION). */
export const MAX_SELECTS = 40
/** Nombre maximal de sources (tables, vues, jointures) dans un meme FROM. */
export const MAX_SOURCES = 12
/** Nombre maximal de colonnes dans une liste SELECT. */
export const MAX_COLONNES = 200
/** Garde-fou de recursion sur les expressions. */
export const MAX_PROFONDEUR_EXPRESSION = 120
/** Nombre maximal de valeurs produites par generate_series. */
export const MAX_GENERATE_SERIES = 10_000
/** Longueur maximale accordee a lpad/rpad (evite d'allouer des chaines geantes). */
export const MAX_LONGUEUR_PAD = 1_000

/** Identifiant simple, deja en minuscules (le texte est normalise avant l'analyse). */
export const RE_IDENTIFIANT = /^[a-z_][a-z0-9_]{0,62}$/

/**
 * Fonctions permises (noms en minuscules). Toute autre fonction est refusee, y compris celles
 * que le parseur ne sait pas classer.
 */
export const FONCTIONS_AGREGAT = new Set([
  'sum',
  'count',
  'avg',
  'min',
  'max',
  'string_agg',
  'array_agg',
  'percentile_cont',
  'percentile_disc',
  'mode',
  'stddev',
  'stddev_samp',
  'stddev_pop',
  'variance',
  'var_samp',
  'var_pop',
  'bool_and',
  'bool_or',
  'every',
  'corr',
  'covar_pop',
  'covar_samp',
  'regr_slope',
  'regr_intercept',
  'regr_r2',
])

export const FONCTIONS_FENETRE = new Set([
  'row_number',
  'rank',
  'dense_rank',
  'lag',
  'lead',
  'first_value',
  'last_value',
  'nth_value',
  'ntile',
  'cume_dist',
  'percent_rank',
])

export const FONCTIONS_SCALAIRES = new Set([
  // Dates
  'date_trunc',
  'date_part',
  'age',
  'to_char',
  'to_date',
  'to_timestamp',
  'make_date',
  'now',
  'current_date',
  'current_timestamp',
  'current_time',
  'localtimestamp',
  'localtime',
  // Texte
  'lower',
  'upper',
  'initcap',
  'trim',
  'btrim',
  'ltrim',
  'rtrim',
  'substring',
  'substr',
  'replace',
  'translate',
  'concat',
  'concat_ws',
  'length',
  'char_length',
  'character_length',
  'split_part',
  'lpad',
  'rpad',
  'left',
  'right',
  'position',
  'strpos',
  'starts_with',
  'to_number',
  // Valeurs nulles et comparaisons
  'coalesce',
  'nullif',
  'greatest',
  'least',
  // Mathematiques
  'round',
  'floor',
  'ceil',
  'ceiling',
  'abs',
  'trunc',
  'power',
  'sqrt',
  'cbrt',
  'mod',
  'div',
  'ln',
  'log',
  'log10',
  'exp',
  'sign',
  // Predicats de sous-requete et negation parenthesee (le parseur les rend comme des fonctions)
  'not',
  'exists',
  'any',
  'all',
  'some',
  // Serie bornee (voir controle dedie)
  'generate_series',
])

/** Fonctions dont un argument de longueur doit etre un litteral borne. */
export const FONCTIONS_PAD = new Set(['lpad', 'rpad'])

/** Toutes les fonctions permises, quel que soit le noeud qui les porte. */
export const FONCTIONS_PERMISES = new Set([
  ...FONCTIONS_AGREGAT,
  ...FONCTIONS_FENETRE,
  ...FONCTIONS_SCALAIRES,
])

/** Types autorises dans un cast (`::type` ou `CAST(x AS type)`), en majuscules comme le parseur. */
export const TYPES_CAST = new Set([
  'INT',
  'INTEGER',
  'INT2',
  'INT4',
  'INT8',
  'SMALLINT',
  'BIGINT',
  'NUMERIC',
  'DECIMAL',
  'REAL',
  'FLOAT',
  'FLOAT4',
  'FLOAT8',
  'DOUBLE PRECISION',
  'TEXT',
  'VARCHAR',
  'CHAR',
  'CHARACTER',
  'CHARACTER VARYING',
  'DATE',
  'TIMESTAMP',
  'TIMESTAMPTZ',
  'INTERVAL',
  'BOOLEAN',
  'BOOL',
])

/** Operateurs binaires permis (en majuscules). Les expressions regulieres sont exclues. */
export const OPERATEURS_BINAIRES = new Set([
  '=',
  '<>',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '||',
  'AND',
  'OR',
  'LIKE',
  'NOT LIKE',
  'ILIKE',
  'NOT ILIKE',
  'IN',
  'NOT IN',
  'BETWEEN',
  'NOT BETWEEN',
  'IS',
  'IS NOT',
  'IS DISTINCT FROM',
  'IS NOT DISTINCT FROM',
])

export const OPERATEURS_UNAIRES = new Set(['-', '+', 'NOT', 'EXISTS', 'NOT EXISTS'])

/** Operations ensemblistes permises entre branches de SELECT. */
export const OPERATIONS_ENSEMBLE = new Set([
  'union',
  'union all',
  'union distinct',
  'intersect',
  'intersect all',
  'except',
  'except all',
])

/** Jointures permises (forme rendue par le parseur). */
export const JOINTURES = new Set([
  'INNER JOIN',
  'JOIN',
  'LEFT JOIN',
  'LEFT OUTER JOIN',
  'RIGHT JOIN',
  'RIGHT OUTER JOIN',
  'FULL JOIN',
  'FULL OUTER JOIN',
  'CROSS JOIN',
])

/** Champs d'EXTRACT permis. */
export const CHAMPS_EXTRACT = new Set([
  'year',
  'month',
  'day',
  'quarter',
  'week',
  'dow',
  'isodow',
  'doy',
  'isoyear',
  'epoch',
  'hour',
  'minute',
  'second',
  'decade',
  'century',
])

/** Unites d'INTERVAL permises (`INTERVAL '1' MONTH`). Vide = unite dans la chaine. */
export const UNITES_INTERVAL = new Set([
  '',
  'year',
  'month',
  'week',
  'day',
  'hour',
  'minute',
  'second',
])

/**
 * Mots que le parseur rend en noeud « origin » a l'interieur d'une fonction (TRIM(BOTH ... FROM),
 * POSITION(... IN ...)) ou d'une clause de fenetre (ROWS BETWEEN ... AND CURRENT ROW).
 */
export const MOTS_ORIGIN = new Set([
  'both',
  'leading',
  'trailing',
  'from',
  'in',
  'rows',
  'range',
  'groups',
  'current row',
  'unbounded preceding',
  'unbounded following',
])

/** Valeur d'une borne de fenetre rendue comme un « nombre » par le parseur : `2 PRECEDING`. */
export const RE_BORNE_FENETRE = /^\d{1,6} (preceding|following)$/i
/** Litteral numerique accepte. */
export const RE_NOMBRE = /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i

/**
 * Noms qui ne sont JAMAIS des colonnes : Postgres les evalue comme des fonctions systeme
 * (utilisateur courant, base, schema). Le parseur les prend pour des colonnes.
 */
export const COLONNES_INTERDITES = new Set([
  'user',
  'current_user',
  'session_user',
  'current_role',
  'current_catalog',
  'current_schema',
  'system_user',
  'oid',
  'ctid',
  'xmin',
  'xmax',
  'cmin',
  'cmax',
  'tableoid',
])

/**
 * Filet LEXICAL : mots refuses partout hors chaines litterales, en secours de l'arbre (le
 * parseur peut diverger de Postgres). Ce sont des commandes, des mots qui n'ont pas de sens
 * dans une lecture, ou des noms systeme. Aucun n'est un nom de colonne metier.
 */
export const MOTS_INTERDITS = new Set([
  // Commandes et controle de transaction
  'insert',
  'update',
  'delete',
  'merge',
  'upsert',
  'drop',
  'create',
  'alter',
  'truncate',
  'grant',
  'revoke',
  'copy',
  'call',
  'do',
  'execute',
  'exec',
  'prepare',
  'deallocate',
  'set',
  'reset',
  'show',
  'begin',
  'commit',
  'rollback',
  'abort',
  'savepoint',
  'release',
  'start',
  'transaction',
  'lock',
  'listen',
  'notify',
  'unlisten',
  'vacuum',
  'analyze',
  'analyse',
  'explain',
  'cluster',
  'reindex',
  'refresh',
  'discard',
  'checkpoint',
  'load',
  'import',
  'comment',
  'security',
  // Formes de SELECT refusees
  'into',
  'returning',
  'recursive',
  'for',
  'share',
  'nowait',
  'only',
  'tablesample',
  'table',
  // Noms systeme
  'information_schema',
  'current_setting',
  'set_config',
  'version',
  'current_database',
  'regclass',
  'regproc',
  'regprocedure',
  'regoper',
  'regoperator',
  'regtype',
  'regrole',
  'regnamespace',
  'regconfig',
  'regdictionary',
  'regcollation',
  'xpath',
  'nextval',
  'setval',
  'currval',
  'lastval',
  ...COLONNES_INTERDITES,
])

/** Prefixes refuses hors chaines (fonctions et catalogues systeme, objets externes). */
export const PREFIXES_INTERDITS = [
  'pg_',
  'lo_',
  'dblink',
  'txid_',
  'inet_',
  'xml',
  'query_to_',
  'table_to_',
  'schema_to_',
  'database_to_',
]

/** Vrai si un mot (deja en minuscules) est interdit par le filet lexical. */
export function motInterdit(mot: string): boolean {
  if (MOTS_INTERDITS.has(mot)) return true
  return PREFIXES_INTERDITS.some(p => mot.startsWith(p)) || mot.includes('xml')
}
