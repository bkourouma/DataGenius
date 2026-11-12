/**
 * Analyse du SQL ecrit par l'IA pour l'outil `requete_sql` (architecture §5).
 *
 * L'IA ecrit UN `SELECT` PostgreSQL (CTE `WITH` permises) qui ne lit que des vues logiques
 * `mv_*` fournies par le serveur. `analyserSql` est PUR (aucun acces a la base) et applique,
 * dans cet ordre :
 *
 *  1. un filet LEXICAL (`lexique.ts`) qui refuse ce qui pourrait faire diverger la lecture du
 *     parseur de celle de Postgres, et normalise la casse hors chaines ;
 *  2. l'analyse par `node-sql-parser` (dialecte PostgreSQL), puis un controle STRUCTUREL de
 *     l'arbre a liste blanche stricte : chaque type de noeud, chaque cle de noeud, chaque
 *     fonction, chaque type de cast et chaque operateur doit etre explicitement permis ; tout le
 *     reste est refuse (« forme non prise en charge »). Les tables sont resolues avec la meme
 *     portee que Postgres : une CTE n'est visible que des CTE qui la suivent et de la requete
 *     principale ; toute autre reference doit etre une vue `mv_*` autorisee ;
 *  3. la RE-EMISSION du SQL depuis l'arbre valide (`sqlify`, qui met tous les noms entre
 *     guillemets), puis une seconde analyse complete de ce texte (lexique + arbre) et la
 *     comparaison des empreintes des deux arbres. Le texte rendu (`sqlNormalise`) est donc
 *     exactement celui qui a ete analyse : c'est lui, et jamais le texte brut de l'IA, qui
 *     s'execute.
 *
 * NB : la liste `tableList` du parseur n'est PAS fiable (elle oublie les tables d'une jointure
 * entre parentheses) : on ne s'y fie jamais, on parcourt l'arbre soi-meme.
 */

import { Parser } from 'node-sql-parser'
import { Prisma } from '@prisma/client'

import { controlerLexique } from './lexique'
import {
  CHAMPS_EXTRACT,
  COLONNES_INTERDITES,
  FONCTIONS_AGREGAT,
  FONCTIONS_FENETRE,
  FONCTIONS_PAD,
  FONCTIONS_PERMISES,
  JOINTURES,
  MAX_COLONNES,
  MAX_CTE,
  MAX_GENERATE_SERIES,
  MAX_LONGUEUR_PAD,
  MAX_PROFONDEUR,
  MAX_PROFONDEUR_EXPRESSION,
  MAX_SELECTS,
  MAX_SOURCES,
  MOTS_ORIGIN,
  OPERATEURS_BINAIRES,
  OPERATEURS_UNAIRES,
  OPERATIONS_ENSEMBLE,
  RE_BORNE_FENETRE,
  RE_IDENTIFIANT,
  RE_NOMBRE,
  TYPES_CAST,
  UNITES_INTERVAL,
  motInterdit,
} from './liste-blanche'

export type ResultatAnalyse =
  | { ok: true; sqlNormalise: string; vues: string[] }
  | { ok: false; message: string }

const OPTIONS_PARSEUR = { database: 'PostgresQL' }
const parseur = new Parser()

/** Noeud d'arbre du parseur (structure libre, controlee cle par cle). */
type Noeud = Record<string, unknown>

class RefusSql extends Error {}

function refus(message: string): never {
  throw new RefusSql(message)
}

const FONCTIONS_CITEES =
  'sum, count, avg, min, max, string_agg, percentile_cont, date_trunc, extract, to_char, age, make_date, now, ' +
  'coalesce, nullif, round, abs, greatest, least, lower, upper, trim, substring, replace, concat, split_part, ' +
  'row_number, rank, dense_rank, lag, lead, ntile'

// ---------------------------------------------------------------------------
// Noms reserves : une CTE de l'IA ne peut masquer ni une vue mv_*, ni une table reelle.
// ---------------------------------------------------------------------------

let nomsReservesCache: Set<string> | null = null

/** Tables reelles connues du client Prisma (metadonnees statiques, sans acces a la base). */
function nomsReserves(): Set<string> {
  if (nomsReservesCache) return nomsReservesCache
  const noms = new Set<string>([
    'users',
    'audit_logs',
    'parametres_application',
    'roles',
    'profils',
  ])
  try {
    for (const modele of Prisma.dmmf.datamodel.models) {
      noms.add(modele.name.toLowerCase())
      if (modele.dbName) noms.add(modele.dbName.toLowerCase())
    }
  } catch {
    // Metadonnees indisponibles : la liste minimale ci-dessus reste appliquee.
  }
  nomsReservesCache = noms
  return noms
}

// ---------------------------------------------------------------------------
// Utilitaires de controle
// ---------------------------------------------------------------------------

const absent = (v: unknown) => v === null || v === undefined

function estNoeud(v: unknown): v is Noeud {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Refuse toute cle non prevue qui porte une valeur (le parseur ajoute des cles selon la forme). */
function verifierCles(noeud: Noeud, permises: readonly string[], contexte: string): void {
  for (const [cle, valeur] of Object.entries(noeud)) {
    if (cle === 'loc' || permises.includes(cle)) continue
    if (absent(valeur)) continue
    if (cle === 'parentheses' && typeof valeur === 'boolean') continue
    if (Array.isArray(valeur) && valeur.length === 0) continue
    refus(`Forme SQL non prise en charge (${contexte}). Reformulez avec un SELECT plus simple.`)
  }
}

function identifiant(valeur: unknown, contexte: string): string {
  if (typeof valeur !== 'string' || !RE_IDENTIFIANT.test(valeur)) {
    const affiche = typeof valeur === 'string' ? valeur.slice(0, 40) : String(valeur)
    refus(
      `${contexte} non pris en charge : ${affiche}. Utilisez un nom simple en minuscules (lettres, chiffres, _).`
    )
  }
  if (motInterdit(valeur)) refus(`Nom interdit : ${valeur}.`)
  return valeur
}

/** Nom porte par `{type: 'default'|'double_quote_string', value}` ou par une simple chaine. */
function nomSimple(valeur: unknown, contexte: string): string {
  if (typeof valeur === 'string') return identifiant(valeur, contexte)
  if (estNoeud(valeur)) {
    verifierCles(valeur, ['type', 'value'], contexte)
    if (valeur.type !== 'default' && valeur.type !== 'double_quote_string') {
      refus(`${contexte} non pris en charge.`)
    }
    return identifiant(valeur.value, contexte)
  }
  return refus(`${contexte} non pris en charge.`)
}

function alias(valeur: unknown): string | null {
  if (absent(valeur)) return null
  if (typeof valeur !== 'string' || !RE_IDENTIFIANT.test(valeur)) {
    const affiche = typeof valeur === 'string' ? valeur.slice(0, 40) : '?'
    refus(
      `Alias non pris en charge : ${affiche}. Écrivez un alias simple (ex. AS total_ca), sans liste de colonnes.`
    )
  }
  if (motInterdit(valeur) || COLONNES_INTERDITES.has(valeur)) refus(`Alias interdit : ${valeur}.`)
  return valeur
}

function commandeInterdite(type: unknown): never {
  const t = typeof type === 'string' ? type.toUpperCase() : 'inconnue'
  return refus(
    `Commande interdite : ${t}. Seul un SELECT en lecture seule sur les vues mv_* est permis.`
  )
}

function valeurNumerique(noeud: unknown): number | null {
  if (!estNoeud(noeud)) return null
  if (noeud.type === 'number' || noeud.type === 'bigint') {
    const v = Number(noeud.value)
    return Number.isFinite(v) ? v : null
  }
  if (noeud.type === 'unary_expr' && noeud.operator === '-') {
    const v = valeurNumerique(noeud.expr)
    return v === null ? null : -v
  }
  return null
}

/** Date litterale ('YYYY-MM-DD...') d'un noeud `DATE '...'`, `TIMESTAMP '...'` ou `'...'::date`. */
function valeurDate(noeud: unknown): Date | null {
  if (!estNoeud(noeud)) return null
  let texte: unknown = null
  if (noeud.type === 'date' || noeud.type === 'timestamp') texte = noeud.value
  else if (
    noeud.type === 'cast' &&
    estNoeud(noeud.expr) &&
    noeud.expr.type === 'single_quote_string'
  ) {
    const cibles = Array.isArray(noeud.target) ? (noeud.target as Noeud[]) : []
    const type = String(cibles[0]?.dataType ?? '').toUpperCase()
    if (cibles.length === 1 && ['DATE', 'TIMESTAMP', 'TIMESTAMPTZ'].includes(type))
      texte = noeud.expr.value
  }
  if (typeof texte !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texte)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

const JOURS_PAR_UNITE: Record<string, number> = {
  day: 1,
  days: 1,
  week: 7,
  weeks: 7,
  month: 28,
  months: 28,
  mon: 28,
  mons: 28,
  year: 365,
  years: 365,
}

/** Pas d'INTERVAL litteral en jours (minorant : un mois compte 28 jours), ou null. */
function pasEnJours(noeud: unknown): number | null {
  if (!estNoeud(noeud) || noeud.type !== 'interval' || !estNoeud(noeud.expr)) return null
  if (noeud.expr.type !== 'single_quote_string' || typeof noeud.expr.value !== 'string') return null
  const unite = String(noeud.unit ?? '').toLowerCase()
  const texte = unite ? `${noeud.expr.value} ${unite}` : noeud.expr.value
  const m = /^\s*(\d{1,4})\s*([a-z]+)\s*$/i.exec(texte)
  if (!m) return null
  const parUnite = JOURS_PAR_UNITE[m[2].toLowerCase()]
  const nombre = Number(m[1])
  if (!parUnite || nombre <= 0) return null
  return nombre * parUnite
}

const MESSAGE_SERIE =
  `generate_series n'accepte que des bornes littérales et au plus ${MAX_GENERATE_SERIES} valeurs : ` +
  "generate_series(1, 12) ou generate_series(DATE '2025-04-01', DATE '2026-03-01', INTERVAL '1 month')."

/** generate_series borne : arguments litteraux et nombre de valeurs <= MAX_GENERATE_SERIES. */
function verifierSerie(args: unknown[]): void {
  if (args.length < 2 || args.length > 3) refus(MESSAGE_SERIE)
  const debut = valeurNumerique(args[0])
  const fin = valeurNumerique(args[1])
  if (debut !== null && fin !== null) {
    const pas = args.length === 3 ? valeurNumerique(args[2]) : 1
    if (pas === null || pas === 0) refus(MESSAGE_SERIE)
    const nombre = Math.floor((fin - debut) / pas) + 1
    if (!Number.isFinite(nombre) || nombre > MAX_GENERATE_SERIES) refus(MESSAGE_SERIE)
    return
  }
  const dateDebut = valeurDate(args[0])
  const dateFin = valeurDate(args[1])
  if (dateDebut && dateFin && args.length === 3) {
    const jours = pasEnJours(args[2])
    if (jours === null) refus(MESSAGE_SERIE)
    const ecart = Math.abs(dateFin.getTime() - dateDebut.getTime()) / 86_400_000
    if (ecart / jours + 1 > MAX_GENERATE_SERIES) refus(MESSAGE_SERIE)
    return
  }
  refus(MESSAGE_SERIE)
}

// ---------------------------------------------------------------------------
// Controleur de l'arbre
// ---------------------------------------------------------------------------

interface OptionsSelect {
  racine?: boolean
}

const CLES_SELECT = [
  'with',
  'type',
  'options',
  'distinct',
  'columns',
  'into',
  'from',
  'where',
  'groupby',
  'having',
  'orderby',
  'limit',
  'window',
  '_next',
  'set_op',
  'parentheses_symbol',
  '_parentheses',
  'collate',
]

class Controleur {
  readonly vuesUtilisees = new Set<string>()
  private nbSelects = 0
  private profondeurExpression = 0

  constructor(private readonly vuesAutorisees: ReadonlySet<string>) {}

  private listeVues(): string {
    const vues = [...this.vuesAutorisees].sort()
    return vues.length ? vues.join(', ') : 'aucune vue disponible'
  }

  racine(arbre: unknown): void {
    let ast = arbre
    if (Array.isArray(ast)) {
      if (ast.length !== 1)
        refus(
          'Une seule instruction SELECT est permise : retirez les « ; » et les instructions suivantes.'
        )
      ast = ast[0]
    }
    if (!estNoeud(ast)) refus('Requête SQL non reconnue : écrivez un SELECT.')
    if (ast.type !== 'select') commandeInterdite(ast.type)

    const portee = new Set<string>()
    if (!absent(ast.with)) {
      if (!Array.isArray(ast.with)) refus('Clause WITH non prise en charge.')
      if (ast.with.length > MAX_CTE) refus(`Trop de CTE (${ast.with.length}, maximum ${MAX_CTE}).`)
      for (const cte of ast.with as unknown[]) {
        if (!estNoeud(cte)) refus('Clause WITH non prise en charge.')
        verifierCles(cte, ['name', 'stmt', 'columns', 'recursive'], 'WITH')
        if (cte.recursive) refus('WITH RECURSIVE interdit : utilisez des CTE simples.')
        const nom = nomSimple(cte.name, 'Nom de CTE')
        this.verifierNomCte(nom, portee)
        if (!absent(cte.columns)) {
          if (!Array.isArray(cte.columns)) refus('Liste de colonnes de CTE non prise en charge.')
          for (const colonne of cte.columns as unknown[]) {
            if (!estNoeud(colonne) || colonne.type !== 'column_ref' || !absent(colonne.table)) {
              refus('Liste de colonnes de CTE non prise en charge.')
            }
            this.colonne(colonne)
          }
        }
        // Une CTE ne voit que les CTE definies AVANT elle (WITH non recursif, comme Postgres).
        this.select(this.corpsSousRequete(cte.stmt, 'WITH'), new Set(portee), 1, {})
        portee.add(nom)
      }
    }
    this.select(ast, portee, 0, { racine: true })
  }

  private verifierNomCte(nom: string, portee: ReadonlySet<string>): void {
    const conseil = 'Utilisez un nom descriptif sans préfixe mv_ ni pg_ (ex. ventes_par_pays).'
    if (
      nom.startsWith('mv_') ||
      nom.startsWith('pg_') ||
      this.vuesAutorisees.has(nom) ||
      nomsReserves().has(nom)
    ) {
      refus(`Nom de CTE non autorisé : ${nom}. ${conseil}`)
    }
    if (portee.has(nom)) refus(`CTE définie deux fois : ${nom}.`)
  }

  /** Corps d'une sous-requete : un SELECT, eventuellement enveloppe `{ ast, tableList, ... }`. */
  private corpsSousRequete(valeur: unknown, contexte: string): Noeud {
    if (!estNoeud(valeur)) refus(`Sous-requête non prise en charge (${contexte}).`)
    if (!absent(valeur.ast)) {
      verifierCles(
        valeur,
        ['ast', 'tableList', 'columnList', 'parentheses', '_parentheses'],
        contexte
      )
      if (!estNoeud(valeur.ast)) refus(`Sous-requête non prise en charge (${contexte}).`)
      return valeur.ast
    }
    return valeur
  }

  select(
    noeud: Noeud,
    portee: ReadonlySet<string>,
    profondeur: number,
    options: OptionsSelect
  ): void {
    if (++this.nbSelects > MAX_SELECTS)
      refus(`Requête trop complexe (plus de ${MAX_SELECTS} SELECT).`)
    if (profondeur > MAX_PROFONDEUR) {
      refus(`Sous-requêtes trop imbriquées (maximum ${MAX_PROFONDEUR} niveaux) : utilisez des CTE.`)
    }
    if (noeud.type !== 'select') commandeInterdite(noeud.type)
    verifierCles(noeud, CLES_SELECT, 'SELECT')
    if (!options.racine && !absent(noeud.with)) {
      refus('WITH permis seulement en tête de requête : placez toutes les CTE au début.')
    }
    if (!absent(noeud.options)) refus('Options de SELECT non prises en charge.')
    if (!absent(noeud.collate)) refus('COLLATE non pris en charge.')

    // DISTINCT / DISTINCT ON
    if (estNoeud(noeud.distinct)) {
      verifierCles(noeud.distinct, ['type', 'columns'], 'DISTINCT')
      const type = noeud.distinct.type
      if (!absent(type) && type !== 'DISTINCT' && type !== 'DISTINCT ON')
        refus('DISTINCT non pris en charge.')
      if (Array.isArray(noeud.distinct.columns)) {
        for (const c of noeud.distinct.columns as unknown[])
          this.elementSelect(c, portee, profondeur)
      }
    } else if (!absent(noeud.distinct)) {
      refus('DISTINCT non pris en charge.')
    }

    // SELECT ... INTO
    if (estNoeud(noeud.into)) {
      const into = noeud.into
      if (
        !absent(into.expr) ||
        !absent(into.type) ||
        !absent(into.keyword) ||
        !absent(into.position)
      ) {
        refus('SELECT ... INTO interdit : écrivez un simple SELECT.')
      }
    } else if (!absent(noeud.into)) {
      refus('SELECT ... INTO interdit : écrivez un simple SELECT.')
    }

    // Colonnes
    if (!Array.isArray(noeud.columns)) refus('Liste de colonnes du SELECT non prise en charge.')
    if (noeud.columns.length > MAX_COLONNES) refus(`Trop de colonnes (maximum ${MAX_COLONNES}).`)
    for (const c of noeud.columns as unknown[]) this.elementSelect(c, portee, profondeur)

    // FROM
    if (!absent(noeud.from)) {
      if (!Array.isArray(noeud.from)) refus('Clause FROM non prise en charge.')
      const compteur = { n: 0 }
      for (const source of noeud.from as unknown[])
        this.source(source, portee, profondeur, compteur)
    }

    this.expression(noeud.where, portee, profondeur)
    this.expression(noeud.having, portee, profondeur)

    // GROUP BY
    if (estNoeud(noeud.groupby)) {
      verifierCles(noeud.groupby, ['columns'], 'GROUP BY')
      if (!absent(noeud.groupby.columns)) {
        if (!Array.isArray(noeud.groupby.columns)) refus('GROUP BY non pris en charge.')
        for (const e of noeud.groupby.columns as unknown[]) this.expression(e, portee, profondeur)
      }
    } else if (!absent(noeud.groupby)) {
      refus('GROUP BY non pris en charge.')
    }

    this.ordre(noeud.orderby, portee, profondeur)
    this.limite(noeud.limit)
    this.clauseWindow(noeud.window, portee, profondeur)

    // UNION / INTERSECT / EXCEPT
    if (!absent(noeud._next)) {
      const op = String(noeud.set_op ?? '').toLowerCase()
      if (!OPERATIONS_ENSEMBLE.has(op))
        refus(`Opération ensembliste non prise en charge : ${op || '?'}.`)
      if (!estNoeud(noeud._next)) refus('UNION non pris en charge.')
      this.select(noeud._next, portee, profondeur, {})
    } else if (!absent(noeud.set_op)) {
      refus('UNION non pris en charge.')
    }
  }

  private elementSelect(element: unknown, portee: ReadonlySet<string>, profondeur: number): void {
    if (!estNoeud(element)) refus('Élément de SELECT non pris en charge.')
    verifierCles(element, ['type', 'expr', 'as'], 'colonne du SELECT')
    if (!absent(element.type) && element.type !== 'expr')
      refus('Élément de SELECT non pris en charge.')
    alias(element.as)
    this.expression(element.expr, portee, profondeur)
  }

  private source(
    source: unknown,
    portee: ReadonlySet<string>,
    profondeur: number,
    compteur: { n: number }
  ): void {
    if (!estNoeud(source)) refus('Clause FROM non prise en charge.')
    if (++compteur.n > MAX_SOURCES) refus(`Trop de sources dans le FROM (maximum ${MAX_SOURCES}).`)

    if (typeof source.table === 'string') {
      verifierCles(source, ['db', 'table', 'as', 'join', 'on', 'using', 'schema'], 'FROM')
      if (!absent(source.db) || !absent(source.schema)) {
        refus(
          `Référence qualifiée par un schéma interdite : ${String(source.db ?? source.schema)}.${source.table}. ` +
            `Utilisez seulement les vues : ${this.listeVues()}.`
        )
      }
      const nom = source.table.toLowerCase()
      if (!RE_IDENTIFIANT.test(nom))
        refus(`Table non autorisée : ${nom.slice(0, 40)}. Vues disponibles : ${this.listeVues()}.`)
      if (portee.has(nom)) {
        // CTE de la requete, visible a cet endroit.
      } else if (this.vuesAutorisees.has(nom)) {
        this.vuesUtilisees.add(nom)
      } else {
        refus(`Table non autorisée : ${nom}. Vues disponibles : ${this.listeVues()}.`)
      }
    } else if (estNoeud(source.expr)) {
      verifierCles(source, ['expr', 'as', 'prefix', 'join', 'on', 'using', 'type'], 'FROM')
      if (!absent(source.prefix) && String(source.prefix).toLowerCase() !== 'lateral') {
        refus('Préfixe de FROM non pris en charge.')
      }
      const expr = source.expr
      if (expr.type === 'tables') {
        // Jointure entre parentheses : (a JOIN b ON ...)
        verifierCles(expr, ['type', 'expr', 'parentheses'], 'FROM')
        if (!Array.isArray(expr.expr)) refus('Jointure entre parenthèses non prise en charge.')
        for (const s of expr.expr as unknown[]) this.source(s, portee, profondeur, compteur)
      } else if (!absent(expr.ast) || expr.type === 'select') {
        this.select(this.corpsSousRequete(expr, 'FROM'), portee, profondeur + 1, {})
      } else if (expr.type === 'values') {
        verifierCles(expr, ['type', 'values', 'parentheses'], 'VALUES')
        if (!Array.isArray(expr.values)) refus('VALUES non pris en charge.')
        for (const ligne of expr.values as unknown[]) this.expression(ligne, portee, profondeur)
      } else if (source.type === 'expr' && expr.type === 'function') {
        // Fonction en FROM : seule generate_series (bornee) est permise.
        const nom = this.nomFonction(expr)
        if (nom !== 'generate_series')
          refus(
            `Fonction non autorisée dans FROM : ${nom}. Seule generate_series (bornée) est permise.`
          )
        this.expression(expr, portee, profondeur)
      } else {
        refus(
          'Clause FROM non prise en charge : utilisez des vues mv_*, des CTE ou des sous-requêtes.'
        )
      }
    } else if (source.type === 'dual') {
      verifierCles(source, ['type'], 'FROM')
    } else {
      refus('Clause FROM non prise en charge.')
    }

    alias(source.as)
    if (!absent(source.join)) {
      const jointure = String(source.join).toUpperCase()
      if (!JOINTURES.has(jointure)) refus(`Jointure non prise en charge : ${jointure}.`)
    }
    this.expression(source.on, portee, profondeur)
    if (!absent(source.using)) {
      if (!Array.isArray(source.using)) refus('USING non pris en charge.')
      for (const u of source.using as unknown[]) nomSimple(u, 'Colonne de USING')
    }
  }

  private ordre(orderby: unknown, portee: ReadonlySet<string>, profondeur: number): void {
    if (absent(orderby)) return
    if (!Array.isArray(orderby)) refus('ORDER BY non pris en charge.')
    for (const item of orderby as unknown[]) {
      if (!estNoeud(item)) refus('ORDER BY non pris en charge.')
      verifierCles(item, ['expr', 'type', 'nulls'], 'ORDER BY')
      const sens = item.type
      if (!absent(sens) && sens !== 'ASC' && sens !== 'DESC')
        refus('ORDER BY : sens non pris en charge.')
      const nulls = item.nulls
      if (!absent(nulls) && !/^nulls (first|last)$/i.test(String(nulls)))
        refus('ORDER BY : NULLS non pris en charge.')
      this.expression(item.expr, portee, profondeur)
    }
  }

  private limite(limit: unknown): void {
    if (absent(limit)) return
    if (!estNoeud(limit)) refus('LIMIT non pris en charge.')
    verifierCles(limit, ['seperator', 'value'], 'LIMIT')
    const separateur = String(limit.seperator ?? '')
    if (separateur !== '' && separateur !== 'offset') refus('LIMIT : écrivez LIMIT n OFFSET m.')
    if (!Array.isArray(limit.value)) return
    for (const v of limit.value as unknown[]) {
      if (!estNoeud(v) || v.type !== 'number' || !/^\d{1,9}$/.test(String(v.value))) {
        refus('LIMIT et OFFSET doivent être des entiers positifs littéraux.')
      }
    }
  }

  private clauseWindow(window: unknown, portee: ReadonlySet<string>, profondeur: number): void {
    if (absent(window)) return
    if (!estNoeud(window)) refus('WINDOW non pris en charge.')
    verifierCles(window, ['keyword', 'type', 'expr'], 'WINDOW')
    if (!Array.isArray(window.expr)) refus('WINDOW non pris en charge.')
    for (const def of window.expr as unknown[]) {
      if (!estNoeud(def)) refus('WINDOW non pris en charge.')
      verifierCles(def, ['name', 'as_window_specification'], 'WINDOW')
      identifiant(def.name, 'Nom de fenêtre')
      this.specificationFenetre(def.as_window_specification, portee, profondeur)
    }
  }

  /** `OVER w`, `OVER (PARTITION BY ... ORDER BY ... ROWS BETWEEN ...)`. */
  private over(over: unknown, portee: ReadonlySet<string>, profondeur: number): void {
    if (absent(over)) return
    if (!estNoeud(over)) refus('OVER non pris en charge.')
    verifierCles(over, ['type', 'as_window_specification'], 'OVER')
    if (over.type !== 'window') refus('OVER non pris en charge.')
    this.specificationFenetre(over.as_window_specification, portee, profondeur)
  }

  private specificationFenetre(
    spec: unknown,
    portee: ReadonlySet<string>,
    profondeur: number
  ): void {
    if (typeof spec === 'string') {
      identifiant(spec, 'Nom de fenêtre')
      return
    }
    if (!estNoeud(spec)) refus('Fenêtre non prise en charge.')
    verifierCles(spec, ['window_specification', 'parentheses'], 'fenêtre')
    const ws = spec.window_specification
    if (!estNoeud(ws)) refus('Fenêtre non prise en charge.')
    verifierCles(ws, ['name', 'partitionby', 'orderby', 'window_frame_clause'], 'fenêtre')
    if (!absent(ws.name)) identifiant(ws.name, 'Nom de fenêtre')
    if (!absent(ws.partitionby)) {
      if (!Array.isArray(ws.partitionby)) refus('PARTITION BY non pris en charge.')
      for (const p of ws.partitionby as unknown[]) {
        if (estNoeud(p) && p.type === 'expr' && 'expr' in p) {
          verifierCles(p, ['type', 'expr', 'as'], 'PARTITION BY')
          this.expression(p.expr, portee, profondeur)
        } else {
          this.expression(p, portee, profondeur)
        }
      }
    }
    this.ordre(ws.orderby, portee, profondeur)
    if (!absent(ws.window_frame_clause)) this.cadreFenetre(ws.window_frame_clause)
  }

  /** ROWS|RANGE BETWEEN <borne> AND <borne> ; bornes : n PRECEDING/FOLLOWING, CURRENT ROW, UNBOUNDED... */
  private cadreFenetre(cadre: unknown): void {
    const borne = (b: unknown) => {
      if (!estNoeud(b)) refus('Cadre de fenêtre non pris en charge.')
      if (b.type === 'origin' && MOTS_ORIGIN.has(String(b.value).toLowerCase())) return
      if (b.type === 'number' && RE_BORNE_FENETRE.test(String(b.value))) return
      refus(
        'Cadre de fenêtre non pris en charge : utilisez ROWS BETWEEN n PRECEDING AND CURRENT ROW.'
      )
    }
    if (!estNoeud(cadre)) refus('Cadre de fenêtre non pris en charge.')
    if (cadre.type === 'binary_expr' && String(cadre.operator).toUpperCase() === 'BETWEEN') {
      verifierCles(cadre, ['type', 'operator', 'left', 'right'], 'cadre de fenêtre')
      borne(cadre.left)
      const droite = cadre.right
      if (!estNoeud(droite) || droite.type !== 'expr_list' || !Array.isArray(droite.value)) {
        refus('Cadre de fenêtre non pris en charge.')
      }
      for (const b of droite.value as unknown[]) borne(b)
      return
    }
    borne(cadre)
  }

  private nomFonction(noeud: Noeud): string {
    const nom = noeud.name
    if (typeof nom === 'string') return nom.toLowerCase()
    if (!estNoeud(nom)) refus('Fonction non prise en charge.')
    verifierCles(nom, ['name', 'schema'], 'fonction')
    if (!absent(nom.schema)) {
      refus(
        'Fonction qualifiée par un schéma interdite : appelez seulement les fonctions usuelles.'
      )
    }
    if (!Array.isArray(nom.name) || nom.name.length !== 1 || !estNoeud(nom.name[0])) {
      refus(
        'Fonction qualifiée par un schéma interdite : appelez seulement les fonctions usuelles.'
      )
    }
    const partie = nom.name[0] as Noeud
    verifierCles(partie, ['type', 'value'], 'fonction')
    if (!['default', 'origin', 'double_quote_string'].includes(String(partie.type)))
      refus('Fonction non prise en charge.')
    if (typeof partie.value !== 'string') refus('Fonction non prise en charge.')
    return partie.value.toLowerCase()
  }

  private exigerFonction(nom: string): void {
    if (!FONCTIONS_PERMISES.has(nom)) {
      refus(
        `Fonction non autorisée : ${nom.slice(0, 40)}. Fonctions permises, entre autres : ${FONCTIONS_CITEES}.`
      )
    }
  }

  private colonne(noeud: Noeud): void {
    verifierCles(noeud, ['type', 'table', 'column', 'collate', 'schema', 'db'], 'colonne')
    if (!absent(noeud.schema) || !absent(noeud.db)) {
      refus('Référence qualifiée par un schéma interdite : écrivez alias.colonne.')
    }
    if (!absent(noeud.collate)) refus('COLLATE non pris en charge.')
    if (!absent(noeud.table)) nomSimple(noeud.table, 'Alias de table')
    const colonne = noeud.column
    if (colonne === '*') return
    let nom: string
    if (estNoeud(colonne) && estNoeud(colonne.expr)) {
      verifierCles(colonne, ['expr'], 'colonne')
      nom = nomSimple(colonne.expr, 'Nom de colonne')
    } else {
      nom = nomSimple(colonne, 'Nom de colonne')
    }
    if (COLONNES_INTERDITES.has(nom)) refus(`Nom interdit : ${nom} (fonction système).`)
  }

  private chaine(noeud: Noeud): void {
    verifierCles(noeud, ['type', 'value', 'escape'], 'chaîne')
    const v = noeud.value
    if (typeof v !== 'string' || v.replace(/''/g, '').includes("'") || v.includes('\\')) {
      refus('Chaîne littérale non prise en charge.')
    }
    if (!absent(noeud.escape)) {
      if (
        !estNoeud(noeud.escape) ||
        !estNoeud(noeud.escape.value) ||
        noeud.escape.value.type !== 'single_quote_string'
      ) {
        refus('ESCAPE non pris en charge.')
      }
      verifierCles(noeud.escape, ['type', 'value'], 'ESCAPE')
      this.chaine(noeud.escape.value)
    }
  }

  expression(e: unknown, portee: ReadonlySet<string>, profondeur: number): void {
    if (absent(e)) return
    if (Array.isArray(e)) {
      for (const x of e) this.expression(x, portee, profondeur)
      return
    }
    if (!estNoeud(e)) refus('Expression SQL non prise en charge.')
    if (++this.profondeurExpression > MAX_PROFONDEUR_EXPRESSION)
      refus('Expression trop imbriquée : simplifiez-la.')
    try {
      this.expressionNoeud(e, portee, profondeur)
    } finally {
      this.profondeurExpression--
    }
  }

  private expressionNoeud(e: Noeud, portee: ReadonlySet<string>, profondeur: number): void {
    // Sous-requete scalaire, EXISTS, IN (...) : enveloppe `{ ast, tableList, columnList }`.
    if (absent(e.type) && !absent(e.ast)) {
      this.select(this.corpsSousRequete(e, 'sous-requête'), portee, profondeur + 1, {})
      return
    }
    const type = String(e.type)
    switch (type) {
      case 'select':
        this.select(e, portee, profondeur + 1, {})
        return
      case 'column_ref':
        this.colonne(e)
        return
      case 'number':
      case 'bigint':
        verifierCles(e, ['type', 'value'], 'nombre')
        if (!RE_NOMBRE.test(String(e.value))) refus('Nombre littéral non pris en charge.')
        return
      case 'single_quote_string':
        this.chaine(e)
        return
      case 'date':
      case 'timestamp':
      case 'time':
        verifierCles(e, ['type', 'value'], 'date')
        this.chaine({ type: 'single_quote_string', value: e.value })
        return
      case 'bool':
      case 'boolean':
      case 'null':
        verifierCles(e, ['type', 'value'], 'littéral')
        return
      case 'star':
        verifierCles(e, ['type', 'value'], 'étoile')
        if (e.value !== '*') refus('Expression SQL non prise en charge.')
        return
      case 'double_quote_string':
        // Identifiant entre guillemets en position d'expression : une colonne.
        verifierCles(e, ['type', 'value'], 'identifiant')
        identifiant(e.value, 'Nom de colonne')
        if (COLONNES_INTERDITES.has(String(e.value))) refus(`Nom interdit : ${String(e.value)}.`)
        return
      case 'origin':
        verifierCles(e, ['type', 'value'], 'mot-clé')
        if (!MOTS_ORIGIN.has(String(e.value).toLowerCase())) {
          refus(`Mot-clé non pris en charge : ${String(e.value).slice(0, 30)}.`)
        }
        return
      case 'binary_expr': {
        verifierCles(e, ['type', 'operator', 'left', 'right'], 'opérateur')
        const op = String(e.operator).toUpperCase()
        if (!OPERATEURS_BINAIRES.has(op)) {
          refus(
            `Opérateur non autorisé : ${op.slice(0, 20)}. Opérateurs permis : = <> < > <= >= + - * / % || AND OR LIKE ILIKE IN BETWEEN IS.`
          )
        }
        this.expression(e.left, portee, profondeur)
        this.expression(e.right, portee, profondeur)
        return
      }
      case 'unary_expr': {
        verifierCles(e, ['type', 'operator', 'expr'], 'opérateur')
        const op = String(e.operator).toUpperCase()
        if (!OPERATEURS_UNAIRES.has(op)) refus(`Opérateur non autorisé : ${op.slice(0, 20)}.`)
        this.expression(e.expr, portee, profondeur)
        return
      }
      case 'expr_list':
        verifierCles(e, ['type', 'value'], 'liste')
        if (!Array.isArray(e.value)) refus('Liste de valeurs non prise en charge.')
        this.expression(e.value, portee, profondeur)
        return
      case 'function':
        this.fonction(e, portee, profondeur)
        return
      case 'aggr_func':
        this.agregat(e, portee, profondeur)
        return
      case 'window_func':
        this.fonctionFenetre(e, portee, profondeur)
        return
      case 'cast':
        this.cast(e, portee, profondeur)
        return
      case 'case':
        verifierCles(e, ['type', 'expr', 'args'], 'CASE')
        this.expression(e.expr, portee, profondeur)
        if (!Array.isArray(e.args)) refus('CASE non pris en charge.')
        for (const branche of e.args as unknown[]) {
          if (!estNoeud(branche)) refus('CASE non pris en charge.')
          if (branche.type === 'when') {
            verifierCles(branche, ['type', 'cond', 'result'], 'CASE')
            this.expression(branche.cond, portee, profondeur)
          } else if (branche.type === 'else') {
            verifierCles(branche, ['type', 'result'], 'CASE')
          } else {
            refus('CASE non pris en charge.')
          }
          this.expression(branche.result, portee, profondeur)
        }
        return
      case 'interval': {
        verifierCles(e, ['type', 'expr', 'unit'], 'INTERVAL')
        if (!estNoeud(e.expr) || e.expr.type !== 'single_quote_string') {
          refus("INTERVAL : écrivez INTERVAL '1 month'.")
        }
        this.chaine(e.expr)
        if (!UNITES_INTERVAL.has(String(e.unit ?? '').toLowerCase()))
          refus("INTERVAL : écrivez INTERVAL '1 month'.")
        return
      }
      case 'extract': {
        verifierCles(e, ['type', 'args'], 'EXTRACT')
        const args = e.args
        if (!estNoeud(args)) refus('EXTRACT non pris en charge.')
        verifierCles(args, ['field', 'cast_type', 'source'], 'EXTRACT')
        if (!CHAMPS_EXTRACT.has(String(args.field).toLowerCase())) {
          refus(
            `EXTRACT : champ non pris en charge (${String(args.field).slice(0, 20)}). Champs permis : year, quarter, month, week, day, dow, doy, epoch.`
          )
        }
        this.expression(args.source, portee, profondeur)
        return
      }
      default:
        refus(
          `Forme SQL non prise en charge : ${type.slice(0, 30)}. Reformulez avec des fonctions usuelles.`
        )
    }
  }

  private argumentsListe(args: unknown): unknown[] {
    if (absent(args)) return []
    if (!estNoeud(args) || args.type !== 'expr_list')
      refus('Arguments de fonction non pris en charge.')
    verifierCles(args, ['type', 'value'], 'arguments')
    if (absent(args.value)) return []
    if (!Array.isArray(args.value)) refus('Arguments de fonction non pris en charge.')
    return args.value as unknown[]
  }

  private fonction(e: Noeud, portee: ReadonlySet<string>, profondeur: number): void {
    verifierCles(e, ['type', 'name', 'args', 'over', 'separator', 'args_parentheses'], 'fonction')
    const nom = this.nomFonction(e)
    this.exigerFonction(nom)
    if (!absent(e.separator) && e.separator !== ' ') refus('Fonction non prise en charge.')
    const args = this.argumentsListe(e.args)
    if (nom === 'generate_series') verifierSerie(args)
    if (FONCTIONS_PAD.has(nom)) {
      const longueur = valeurNumerique(args[1])
      if (longueur === null || longueur < 0 || longueur > MAX_LONGUEUR_PAD) {
        refus(`${nom} : la longueur doit être un entier littéral entre 0 et ${MAX_LONGUEUR_PAD}.`)
      }
    }
    if (!absent(e.over) && !FONCTIONS_FENETRE.has(nom) && !FONCTIONS_AGREGAT.has(nom)) {
      refus(`OVER n'est permis qu'avec une fonction de fenêtre ou un agrégat (pas ${nom}).`)
    }
    this.expression(args, portee, profondeur)
    this.over(e.over, portee, profondeur)
  }

  private agregat(e: Noeud, portee: ReadonlySet<string>, profondeur: number): void {
    verifierCles(e, ['type', 'name', 'args', 'over', 'filter', 'within_group_orderby'], 'agrégat')
    const nom = String(e.name).toLowerCase()
    if (!FONCTIONS_AGREGAT.has(nom)) this.exigerFonction(nom)
    if (!FONCTIONS_AGREGAT.has(nom)) refus(`Agrégat non autorisé : ${nom}.`)
    const args = e.args
    if (!absent(args)) {
      if (!estNoeud(args)) refus('Arguments d’agrégat non pris en charge.')
      verifierCles(args, ['expr', 'distinct', 'orderby', 'separator', 'parentheses'], 'agrégat')
      if (!absent(args.distinct) && args.distinct !== 'DISTINCT')
        refus('DISTINCT d’agrégat non pris en charge.')
      this.expression(args.expr, portee, profondeur)
      this.ordre(args.orderby, portee, profondeur)
      if (!absent(args.separator)) {
        const sep = args.separator
        if (estNoeud(sep)) {
          verifierCles(sep, ['symbol', 'delimiter'], 'séparateur')
          if (sep.symbol !== ',') refus('Séparateur d’agrégat non pris en charge.')
          this.expression(sep.delimiter, portee, profondeur)
        } else {
          refus('Séparateur d’agrégat non pris en charge.')
        }
      }
    }
    this.ordre(e.within_group_orderby, portee, profondeur)
    if (!absent(e.filter)) {
      const filtre = e.filter
      if (!estNoeud(filtre)) refus('FILTER non pris en charge.')
      verifierCles(filtre, ['keyword', 'parentheses', 'where'], 'FILTER')
      this.expression(filtre.where, portee, profondeur)
    }
    this.over(e.over, portee, profondeur)
  }

  private fonctionFenetre(e: Noeud, portee: ReadonlySet<string>, profondeur: number): void {
    verifierCles(e, ['type', 'name', 'args', 'over', 'consider_nulls'], 'fonction de fenêtre')
    const nom = String(e.name).toLowerCase()
    if (!FONCTIONS_FENETRE.has(nom)) {
      this.exigerFonction(nom)
      refus(`Fonction de fenêtre non autorisée : ${nom}.`)
    }
    if (!absent(e.consider_nulls) && !/^respect nulls$/i.test(String(e.consider_nulls))) {
      refus('IGNORE NULLS non pris en charge.')
    }
    this.expression(this.argumentsListe(e.args), portee, profondeur)
    if (absent(e.over)) refus(`${nom} exige une clause OVER (...).`)
    this.over(e.over, portee, profondeur)
  }

  private cast(e: Noeud, portee: ReadonlySet<string>, profondeur: number): void {
    verifierCles(e, ['type', 'keyword', 'expr', 'symbol', 'target'], 'cast')
    if (!absent(e.keyword) && e.keyword !== 'cast') refus('Cast non pris en charge.')
    if (!absent(e.symbol) && e.symbol !== '::' && e.symbol !== 'as')
      refus('Cast non pris en charge.')
    if (!Array.isArray(e.target) || e.target.length === 0) refus('Cast non pris en charge.')
    for (const cible of e.target as unknown[]) {
      if (!estNoeud(cible)) refus('Cast non pris en charge.')
      verifierCles(cible, ['dataType', 'length', 'scale', 'parentheses', 'suffix'], 'cast')
      const type = String(cible.dataType ?? '').toUpperCase()
      if (!TYPES_CAST.has(type)) {
        refus(
          `Cast vers ${type.toLowerCase().slice(0, 30) || '?'} interdit. Types permis : int, bigint, numeric, float8, text, date, timestamp, boolean.`
        )
      }
      for (const n of [cible.length, cible.scale]) {
        if (!absent(n) && !(typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1000)) {
          refus('Précision de cast non prise en charge.')
        }
      }
    }
    this.expression(e.expr, portee, profondeur)
  }
}

// ---------------------------------------------------------------------------
// Alias des colonnes de sortie
// ---------------------------------------------------------------------------

function nomParDefaut(expr: unknown): string {
  if (!estNoeud(expr)) return 'valeur'
  if (expr.type === 'aggr_func' || expr.type === 'window_func')
    return String(expr.name).toLowerCase()
  if (expr.type === 'function' && estNoeud(expr.name) && Array.isArray(expr.name.name)) {
    const partie = expr.name.name[0]
    if (estNoeud(partie) && typeof partie.value === 'string') return partie.value.toLowerCase()
  }
  if (expr.type === 'cast') return nomParDefaut(expr.expr)
  if (expr.type === 'column_ref' && estNoeud(expr.column) && estNoeud(expr.column.expr)) {
    return String(expr.column.expr.value)
  }
  if (expr.type === 'extract' && estNoeud(expr.args)) return String(expr.args.field).toLowerCase()
  return 'valeur'
}

function nomColonneSortie(element: Noeud): string | null {
  if (typeof element.as === 'string') return element.as
  const expr = element.expr
  if (estNoeud(expr) && expr.type === 'column_ref') {
    if (expr.column === '*') return null
    if (estNoeud(expr.column) && estNoeud(expr.column.expr)) return String(expr.column.expr.value)
  }
  return null
}

/**
 * Donne un alias aux expressions non nommees de la liste SELECT de tete (les lignes sont des
 * objets : deux colonnes de meme nom s'ecraseraient) et refuse les noms explicites en double.
 */
function nommerColonnes(ast: Noeud): void {
  const colonnes = Array.isArray(ast.columns) ? (ast.columns as Noeud[]) : []
  const pris = new Set<string>()
  for (const element of colonnes) {
    const nom = nomColonneSortie(element)
    if (nom === null) continue
    if (pris.has(nom))
      refus(`Nom de colonne en double : ${nom}. Donnez des alias uniques (AS ...).`)
    pris.add(nom)
  }
  for (const element of colonnes) {
    if (typeof element.as === 'string') continue
    const expr = element.expr
    if (estNoeud(expr) && expr.type === 'column_ref') continue
    let base = nomParDefaut(expr).replace(/[^a-z0-9_]/g, '_')
    if (!RE_IDENTIFIANT.test(base) || motInterdit(base)) base = 'valeur'
    let nom = base
    for (let k = 2; pris.has(nom); k++) nom = `${base}_${k}`
    element.as = nom
    pris.add(nom)
  }
}

// ---------------------------------------------------------------------------
// Empreinte : verifie que la re-emission n'a rien perdu ni ajoute
// ---------------------------------------------------------------------------

const CLES_HORS_EMPREINTE = new Set([
  'loc',
  'tableList',
  'columnList',
  'parentheses',
  '_parentheses',
  'parentheses_symbol',
])

function empreinte(arbre: unknown): string[] {
  const feuilles: string[] = []
  const parcourir = (v: unknown, cle: string) => {
    if (absent(v) || CLES_HORS_EMPREINTE.has(cle)) return
    if (Array.isArray(v)) {
      for (const x of v) parcourir(x, cle)
      return
    }
    if (typeof v === 'object') {
      const o = v as Noeud
      // Identifiant `{ type: 'default' | 'double_quote_string', value }` : equivaut a la chaine seule.
      if (
        (o.type === 'default' || o.type === 'double_quote_string') &&
        typeof o.value === 'string' &&
        Object.keys(o).every(k => k === 'type' || k === 'value' || k === 'loc')
      ) {
        feuilles.push(`${cle}=${o.value.toLowerCase()}`)
        return
      }
      for (const [k, x] of Object.entries(o)) parcourir(x, k)
      return
    }
    let texte = String(v).toLowerCase()
    if (cle === 'type') {
      // Variantes sans effet : identifiant cite ou non, sens ASC implicite, sous-requete enveloppee.
      if (
        texte === 'default' ||
        texte === 'double_quote_string' ||
        texte === 'asc' ||
        texte === 'select'
      )
        return
    }
    if (cle === 'value' && typeof v === 'number') texte = String(v)
    feuilles.push(`${cle}=${texte}`)
  }
  parcourir(arbre, '')
  return feuilles.sort()
}

// ---------------------------------------------------------------------------
// Point d'entree
// ---------------------------------------------------------------------------

function messageSyntaxe(erreur: unknown, texte: string): string {
  const e = erreur as { location?: { start?: { offset?: number } }; found?: unknown }
  const position = e?.location?.start?.offset
  const extrait =
    typeof position === 'number'
      ? texte.slice(Math.max(0, position - 20), position + 20).replace(/\s+/g, ' ')
      : ''
  return (
    'Syntaxe SQL non reconnue' +
    (extrait ? ` près de « ${extrait} »` : '') +
    '. Écrivez un SELECT PostgreSQL simple. Non pris en charge : SUBSTRING(... FROM ... FOR ...) (écrire substring(t, debut, longueur)), ' +
    'FETCH FIRST (écrire LIMIT), GROUPING SETS/ROLLUP, opérateur ^ (écrire power), TABLE x, VALUES seul.'
  )
}

function analyserArbre(
  texte: string,
  vuesAutorisees: ReadonlySet<string>,
  premierPassage: boolean
): { ast: Noeud; vues: Set<string> } {
  let arbre: unknown
  try {
    arbre = parseur.astify(texte, OPTIONS_PARSEUR)
  } catch (erreur) {
    if (premierPassage) refus(messageSyntaxe(erreur, texte))
    refus('Forme SQL non prise en charge : reformulez la requête plus simplement.')
  }
  const controleur = new Controleur(vuesAutorisees)
  controleur.racine(arbre)
  const ast = (Array.isArray(arbre) ? arbre[0] : arbre) as Noeud
  return { ast, vues: controleur.vuesUtilisees }
}

/**
 * Analyse le SQL de l'IA. PUR : aucun acces a la base.
 * `vues` = les vues `mv_*` effectivement referencees (a injecter en CTE).
 */
export function analyserSql(sql: string, vuesAutorisees: string[]): ResultatAnalyse {
  const r = analyserSqlDetaille(sql, vuesAutorisees)
  return r.ok ? { ok: true, sqlNormalise: r.sqlNormalise, vues: r.vues } : r
}

/** Comme `analyserSql`, avec en plus les noms des colonnes de sortie ('*' pour une etoile). */
export type ResultatAnalyseDetaille =
  | { ok: true; sqlNormalise: string; vues: string[]; colonnesSortie: string[] }
  | { ok: false; message: string }

export function analyserSqlDetaille(
  sql: string,
  vuesAutorisees: string[]
): ResultatAnalyseDetaille {
  try {
    const autorisees = new Set(
      vuesAutorisees.map(v => v.toLowerCase()).filter(v => /^mv_[a-z0-9_]+$/.test(v))
    )

    // 1. Lexique + premier arbre (messages detailles pour l'IA).
    const lexique = controlerLexique(sql)
    if (!lexique.ok) return lexique
    const premier = analyserArbre(lexique.texte, autorisees, true)
    nommerColonnes(premier.ast)

    // 2. Re-emission depuis l'arbre valide, puis seconde analyse complete de CE texte.
    let emis: string
    try {
      // sqlify MODIFIE l'arbre qu'on lui passe : on lui donne une copie.
      emis = parseur.sqlify(structuredClone(premier.ast) as never, OPTIONS_PARSEUR)
    } catch {
      return {
        ok: false,
        message: 'Forme SQL non prise en charge : reformulez la requête plus simplement.',
      }
    }
    const lexique2 = controlerLexique(emis)
    if (!lexique2.ok) {
      return {
        ok: false,
        message: 'Forme SQL non prise en charge : reformulez la requête plus simplement.',
      }
    }
    const second = analyserArbre(lexique2.texte, autorisees, false)

    // 3. Le texte re-emis doit dire la meme chose que l'arbre analyse.
    const e1 = empreinte(premier.ast)
    const e2 = empreinte(second.ast)
    const memesVues =
      premier.vues.size === second.vues.size && [...premier.vues].every(v => second.vues.has(v))
    if (!memesVues || e1.length !== e2.length || e1.some((f, i) => f !== e2[i])) {
      return {
        ok: false,
        message: 'Forme SQL non prise en charge : reformulez la requête plus simplement.',
      }
    }

    const colonnesSortie = (
      Array.isArray(second.ast.columns) ? (second.ast.columns as Noeud[]) : []
    ).map(element => nomColonneSortie(element) ?? '*')
    return {
      ok: true,
      sqlNormalise: lexique2.texte,
      vues: [...second.vues].sort(),
      colonnesSortie,
    }
  } catch (erreur) {
    if (erreur instanceof RefusSql) return { ok: false, message: erreur.message }
    // Erreur interne inattendue : refus prudent, sans detail technique.
    return {
      ok: false,
      message: 'Requête SQL refusée : forme non prise en charge. Reformulez avec un SELECT simple.',
    }
  }
}
