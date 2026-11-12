/**
 * Traduction des erreurs d'execution du SQL controle en `ErreurDonnees` destinees au MODELE.
 *
 * Le message dit quoi corriger, en une ou deux phrases. Il ne reprend JAMAIS le message brut de
 * Postgres ni de Prisma (qui peut citer une table reelle, un indice « Perhaps you meant... », la
 * requete complete avec les CTE serveur, une trace ou la chaine de connexion) : seuls des
 * fragments extraits par motif et controles (un nom de colonne simple, une signature de
 * fonction faite de mots simples) sont repris.
 */

import { ErreurDonnees } from '../types'

/** Colonnes connues des vues utilisees, pour orienter le modele. */
export interface AideColonnes {
  vues: { nom: string; colonnes: string[] }[]
}

interface ErreurBrute {
  code?: unknown
  message?: unknown
  meta?: { code?: unknown; message?: unknown }
}

/** SQLSTATE et message Postgres extraits d'une erreur Prisma (P2010) ou du pilote. */
export function extraireErreurPostgres(erreur: unknown): {
  sqlstate: string | null
  texte: string
  codePrisma: string | null
} {
  const e = (erreur ?? {}) as ErreurBrute
  const codePrisma = typeof e.code === 'string' && /^P\d{4}$/.test(e.code) ? e.code : null
  let sqlstate: string | null = null
  if (typeof e.meta?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.meta.code)) sqlstate = e.meta.code
  else if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) sqlstate = e.code
  const message =
    typeof e.meta?.message === 'string'
      ? e.meta.message
      : typeof e.message === 'string'
        ? e.message
        : ''
  if (!sqlstate) {
    const m = /Code: `?([0-9A-Z]{5})`?/.exec(message)
    if (m) sqlstate = m[1]
  }
  return { sqlstate, texte: message, codePrisma }
}

/** Garde un fragment s'il n'est fait que de caracteres simples et courts. */
function fragmentSur(
  fragment: string | undefined,
  motif = /^[a-z_][a-z0-9_.]{0,62}$/
): string | null {
  if (!fragment) return null
  return motif.test(fragment) ? fragment : null
}

function listeColonnes(aide: AideColonnes): string {
  return aide.vues
    .filter(v => v.colonnes.length > 0)
    .map(v => `${v.nom} (${v.colonnes.join(', ')})`)
    .join(' ; ')
}

/** Traduit une erreur d'execution en ErreurDonnees courte, sans fuite. */
export function traduireErreurExecution(
  erreur: unknown,
  aide: AideColonnes,
  delaiMs: number
): ErreurDonnees {
  if (erreur instanceof ErreurDonnees) return erreur
  const { sqlstate, texte, codePrisma } = extraireErreurPostgres(erreur)
  const duree = delaiMs >= 1000 ? `${Math.round(delaiMs / 1000)} s` : `${Math.round(delaiMs)} ms`
  const colonnes = listeColonnes(aide)

  // Delai : statement_timeout (57014) ou delai de transaction Prisma (P2028).
  if (
    sqlstate === '57014' ||
    codePrisma === 'P2028' ||
    /statement timeout|canceling statement/i.test(texte)
  ) {
    return new ErreurDonnees(
      `Requête trop longue (plus de ${duree}), interrompue. Filtrez une période plus courte, agrégez davantage (GROUP BY) ou réduisez les jointures.`,
      'sql_delai'
    )
  }

  switch (sqlstate) {
    case '42703': {
      const m = /column "?([^"\s]+)"? does not exist/i.exec(texte)
      const nom = fragmentSur(m?.[1])
      return new ErreurDonnees(
        `Colonne inconnue${nom ? ` : ${nom}` : ''}.` +
          (colonnes ? ` Colonnes disponibles : ${colonnes}.` : ''),
        'sql_erreur'
      )
    }
    case '42702': {
      const m = /column reference "([^"]+)" is ambiguous/i.exec(texte)
      const nom = fragmentSur(m?.[1])
      return new ErreurDonnees(
        `Colonne ambiguë${nom ? ` : ${nom}` : ''}. Préfixez-la par l'alias de sa vue (ex. v.${nom ?? 'pays_id'}).`,
        'sql_erreur'
      )
    }
    case '42803': {
      const m = /column "([^"]+)" must appear in the GROUP BY clause/i.exec(texte)
      const nom = fragmentSur(m?.[1])
      return new ErreurDonnees(
        `Regroupement incomplet${nom ? ` : ${nom}` : ''} doit figurer dans le GROUP BY ou dans un agrégat (SUM, COUNT, MAX...).`,
        'sql_erreur'
      )
    }
    case '42601':
      return new ErreurDonnees(
        'Erreur de syntaxe SQL. Vérifiez les parenthèses, les virgules et les mots-clés (SELECT ... FROM mv_* WHERE ... GROUP BY ... ORDER BY ...).',
        'sql_erreur'
      )
    case '22012':
      return new ErreurDonnees(
        'Division par zéro : protégez le dénominateur avec NULLIF(denominateur, 0).',
        'sql_erreur'
      )
    case '42883': {
      const m = /function ([a-z_]+\([a-z0-9 ,_[\]]*\)) does not exist/i.exec(texte)
      const signature = fragmentSur(m?.[1], /^[a-z_]+\([a-z0-9 ,_[\]]*\)$/i)
      const op = /operator does not exist: ([a-z0-9 _]+ [^\sa-z0-9]{1,3} [a-z0-9 _]+)/i.exec(texte)
      const operateur = fragmentSur(op?.[1], /^[a-z0-9 _]+ [<>=!~+\-*/%|&]{1,3} [a-z0-9 _]+$/i)
      const detail = signature ? ` (${signature})` : operateur ? ` (${operateur})` : ''
      return new ErreurDonnees(
        `Fonction ou opérateur incompatible avec les types${detail}. Ajoutez un cast explicite (ex. ::numeric pour round, ::text, ::date).`,
        'sql_erreur'
      )
    }
    case '42804':
    case '42846':
      return new ErreurDonnees(
        'Types incompatibles (ex. texte comparé à un nombre). Ajoutez un cast explicite (::numeric, ::text, ::date).',
        'sql_erreur'
      )
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
      return new ErreurDonnees(
        "Valeur invalide pour son type (nombre ou date mal écrit, ou hors limites). Dates au format 'YYYY-MM-DD', périodes au format 'YYYY-MM'.",
        'sql_erreur'
      )
    case '21000':
      return new ErreurDonnees(
        'Une sous-requête scalaire renvoie plusieurs lignes : ajoutez un agrégat (MAX, SUM...) ou LIMIT 1.',
        'sql_erreur'
      )
    case '42P01':
      return new ErreurDonnees(
        `Table inconnue. Utilisez seulement les vues : ${aide.vues.map(v => v.nom).join(', ') || 'mv_*'}.`,
        'sql_interdit'
      )
    case '42P10':
    case '42P20':
      return new ErreurDonnees(
        'Clause ORDER BY, GROUP BY ou fenêtre invalide : référencez une colonne de la liste SELECT.',
        'sql_erreur'
      )
    case '25006':
    case '42501':
      return new ErreurDonnees(
        'Opération interdite : la requête s’exécute en lecture seule sur les vues autorisées.',
        'sql_interdit'
      )
    case '53200':
    case '53100':
    case '54000':
    case '54001':
      return new ErreurDonnees(
        'Requête trop lourde pour le serveur : agrégez davantage ou filtrez une période plus courte.',
        'sql_delai'
      )
    default:
      return new ErreurDonnees(
        `La requête a échoué${sqlstate ? ` (code SQL ${sqlstate})` : ''}. Vérifiez les noms de colonnes, les types et la syntaxe.` +
          (colonnes ? ` Colonnes disponibles : ${colonnes}.` : ''),
        'sql_erreur'
      )
  }
}
