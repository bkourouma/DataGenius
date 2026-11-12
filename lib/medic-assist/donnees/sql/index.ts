/**
 * SQL controle de l'outil `requete_sql` (architecture §5).
 *
 *  - `analyserSql(sql, vuesAutorisees)` : controle PUR (lexique, arbre a liste blanche, re-emission
 *    re-analysee) ; rend le SQL normalise et les vues mv_* referencees.
 *  - `calculerSql(params, ctx, options?, registre?)` : controle, injecte les CTE serveur des vues
 *    referencees, execute en lecture seule avec delai, convertit les valeurs, infere les colonnes
 *    et construit la provenance. Erreurs : `ErreurDonnees` sql_interdit | sql_erreur | sql_delai.
 */

export { analyserSql, analyserSqlDetaille } from './analyseur'
export type { ResultatAnalyse, ResultatAnalyseDetaille } from './analyseur'
export { assemblerSql, calculerSql } from './calcul'
export type { OptionsCalculSql, ParametresSql } from './calcul'
export { infererColonnes, humaniserNom } from './colonnes'
export { traduireErreurExecution } from './erreurs'
