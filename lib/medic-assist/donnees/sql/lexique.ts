/**
 * Analyse LEXICALE defensive du SQL de l'IA, avant (et en secours de) l'analyse de l'arbre.
 *
 * Le parseur `node-sql-parser` n'est pas Postgres : il peut lire un texte autrement que lui
 * (commentaires imbriques, chaines a dollars, chaines `E'...'` avec antislash, identifiants
 * entre guillemets, mots-cles pris pour des colonnes...). Ce premier passage refuse donc tout
 * ce qui pourrait faire diverger les deux lectures :
 *  - commentaires `--` et `/* *\/`, chaines `$$...$$` / `$tag$`, parametres `$1` (tout `$` hors chaine) ;
 *  - chaines prefixees `E'...'`, `U&'...'`, `B'...'`, `X'...'`, `N'...'` et tout antislash ;
 *  - caractere NUL, caracteres de controle, caracteres non ASCII hors chaines ;
 *  - `;` hors chaine (un seul `;` final est tolere et retire) ;
 *  - identifiants entre guillemets qui ne sont pas deja en minuscules simples (`"USERS"`, `"a b"`) ;
 *  - mots interdits (commandes, noms systeme, voir `liste-blanche.ts`).
 *
 * Il rend aussi le texte NORMALISE : tout ce qui est hors chaines litterales passe en
 * minuscules. C'est exactement ce que fait Postgres des identifiants non entre guillemets
 * (repli en minuscules ASCII) ; les identifiants entre guillemets etant deja exiges en
 * minuscules, la normalisation ne change pas le sens de la requete. Elle permet ensuite de
 * re-emettre le SQL depuis l'arbre (qui met les noms entre guillemets) sans changer la casse.
 */

import { LONGUEUR_MAX_SQL, motInterdit } from './liste-blanche'

export type ResultatLexique = { ok: true; texte: string } | { ok: false; message: string }

const EST_LETTRE_IDENT = /[A-Za-z0-9_]/

function refus(message: string): ResultatLexique {
  return { ok: false, message }
}

export function controlerLexique(sqlBrut: string): ResultatLexique {
  if (typeof sqlBrut !== 'string') return refus('La requête SQL doit être un texte.')
  if (sqlBrut.length > LONGUEUR_MAX_SQL) {
    return refus(
      `Requête trop longue (${sqlBrut.length} caractères, maximum ${LONGUEUR_MAX_SQL}). Simplifiez-la ou découpez la question.`
    )
  }
  const sql = sqlBrut.trim()
  if (sql.length === 0) return refus('Requête SQL vide : écrivez un SELECT sur les vues mv_*.')

  let sortie = ''
  let i = 0
  let pointVirguleFinal = false
  const n = sql.length

  while (i < n) {
    const c = sql[i]
    const code = sql.charCodeAt(i)

    if (code === 0) return refus('Caractère NUL interdit dans la requête.')
    // Apres le « ; » final : plus rien que des espaces (verifie avant chaines et identifiants).
    if (pointVirguleFinal && !/\s/.test(c)) {
      return refus(
        'Une seule instruction SELECT est permise : retirez les « ; » et les instructions suivantes.'
      )
    }

    // Chaine litterale '...' ('' = apostrophe echappee).
    if (c === "'") {
      const precedent = i > 0 ? sql[i - 1] : ''
      if (precedent && (EST_LETTRE_IDENT.test(precedent) || precedent === '&')) {
        return refus(
          "Chaînes préfixées interdites (E'...', U&'...', B'...', X'...') : utilisez une chaîne simple 'texte', précédée d'un espace."
        )
      }
      let j = i + 1
      let fermee = false
      while (j < n) {
        const cj = sql.charCodeAt(j)
        if (cj === 0) return refus('Caractère NUL interdit dans la requête.')
        if (cj < 0x20 && cj !== 0x09 && cj !== 0x0a && cj !== 0x0d) {
          return refus('Caractère de contrôle interdit dans une chaîne.')
        }
        if (sql[j] === '\\') {
          return refus("Antislash interdit : écrivez l'apostrophe en la doublant ('l''exemple').")
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2
            continue
          }
          fermee = true
          break
        }
        j++
      }
      if (!fermee)
        return refus(
          "Chaîne non fermée : vérifiez les apostrophes (doublez-les dans un texte : 'l''exemple')."
        )
      sortie += sql.slice(i, j + 1)
      i = j + 1
      continue
    }

    // Identifiant entre guillemets : seulement des minuscules simples (sinon ambigu).
    if (c === '"') {
      if (i > 0 && sql[i - 1] === '&') return refus('Identifiants U&"..." interdits.')
      const fin = sql.indexOf('"', i + 1)
      if (fin < 0) return refus('Guillemet non fermé dans un identifiant.')
      const contenu = sql.slice(i + 1, fin)
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(contenu)) {
        return refus(
          `Identifiant entre guillemets ambigu : "${contenu.slice(0, 40)}". Écrivez les noms sans guillemets, en minuscules (ex. ca_eur).`
        )
      }
      if (motInterdit(contenu)) return refus(`Nom interdit : ${contenu}.`)
      sortie += `"${contenu}"`
      i = fin + 1
      continue
    }

    if (c === '-' && sql[i + 1] === '-')
      return refus('Commentaires « -- » interdits : retirez-les.')
    if (c === '/' && sql[i + 1] === '*')
      return refus('Commentaires « /* */ » interdits : retirez-les.')
    if (c === '$') {
      return refus(
        'Le caractère « $ » est interdit hors des chaînes (paramètres $1, chaînes $$...$$).'
      )
    }
    if (c === '\\') return refus('Antislash interdit dans la requête.')
    if (c === ';') {
      // Un seul « ; » final est tolere : il est retire.
      pointVirguleFinal = true
      i++
      continue
    }
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return refus('Caractère de contrôle interdit dans la requête.')
    }
    if (code > 0x7e) {
      return refus(
        'Caractères non ASCII interdits hors des chaînes : les noms de vues et de colonnes sont en ASCII (ex. quantite, ca_eur).'
      )
    }

    // Mot (identifiant ou mot-cle) : minuscules + filet des mots interdits.
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < n && EST_LETTRE_IDENT.test(sql[j])) j++
      const mot = sql.slice(i, j).toLowerCase()
      if (motInterdit(mot)) return refus(messageMotInterdit(mot))
      sortie += mot
      i = j
      continue
    }

    sortie += c
    i++
  }

  const texte = sortie.trim()
  if (texte.length === 0) return refus('Requête SQL vide : écrivez un SELECT sur les vues mv_*.')
  return { ok: true, texte }
}

function messageMotInterdit(mot: string): string {
  const commandes = new Set([
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
  ])
  if (commandes.has(mot)) {
    return `Commande interdite : ${mot.toUpperCase()}. Seul un SELECT en lecture seule sur les vues mv_* est permis.`
  }
  if (mot === 'into') return 'SELECT ... INTO interdit : écrivez un simple SELECT.'
  if (mot === 'returning') return 'RETURNING interdit : seul un SELECT en lecture seule est permis.'
  if (mot === 'recursive') return 'WITH RECURSIVE interdit : utilisez des CTE simples.'
  if (mot === 'for' || mot === 'share' || mot === 'nowait') {
    return 'FOR UPDATE / FOR SHARE interdits (et SUBSTRING ... FOR non pris en charge : écrivez substring(texte, debut, longueur)).'
  }
  if (mot === 'table' || mot === 'only' || mot === 'tablesample') {
    return `Mot interdit : ${mot.toUpperCase()}. Écrivez SELECT ... FROM mv_*.`
  }
  return `Nom ou fonction système interdit : ${mot}. Utilisez seulement les vues mv_* et les fonctions usuelles (sum, count, date_trunc, coalesce, round...).`
}
