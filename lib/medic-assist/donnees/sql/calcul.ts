import { Prisma } from '@prisma/client'

import { perimetreLisible } from '../moteur/provenance'
import type {
  ColonneJeu,
  ContexteExecution,
  Provenance,
  TypeColonne,
} from '@/lib/medic-assist/contrats'
import { libelleDe } from '../catalogue/communs'
import { empreinteEntrees, registrePostgres } from '../catalogue/registre'
import type { EntreeCatalogue, Registre } from '../catalogue/types'
import { lireEntrepot, normaliserLigne, normaliserValeur, reglesPublication } from '../lecture-seule'
import { DELAI_SQL_MS, ErreurDonnees, MAX_LIGNES_EXPORT, MAX_LIGNES_JEU } from '../types'
import type { OptionsCalcul, ResultatCalcule } from '../types'
import { analyserSqlDetaille } from './analyseur'
import { infererColonnes } from './colonnes'
import { extraireErreurPostgres, traduireErreurExecution } from './erreurs'
import { TEXTES_SQL } from './textes'

/** Options du SQL controle : celles du calcul commun, plus le delai (tests). */
export interface OptionsCalculSql extends OptionsCalcul {
  /** Delai maximal de la requete en ms (defaut DELAI_SQL_MS = 15 s). */
  delaiMs?: number
}

export interface ParametresSql {
  sql: string
  objectif: string
}

/** normaliserLigne, plus les tableaux (array_agg) dont chaque element est converti. */
function normaliserLigneSql(ligne: Record<string, unknown>): Record<string, unknown> {
  const resultat = normaliserLigne(ligne)
  for (const [cle, valeur] of Object.entries(resultat)) {
    if (Array.isArray(valeur)) resultat[cle] = valeur.map(normaliserValeur)
  }
  return resultat
}

/** Alias de la sous-requete exterieure. */
const ALIAS_RESULTAT = 'resultat_requete'
const RE_NOM_VUE = /^mv_[a-z0-9_]+$/

/** Plafond effectif de lignes : MAX_LIGNES_JEU par defaut, jamais au-dela de MAX_LIGNES_EXPORT. */
function plafondLignes(options: OptionsCalculSql | undefined): number {
  const demande = options?.limiteLignes ?? MAX_LIGNES_JEU
  if (!Number.isFinite(demande)) return MAX_LIGNES_JEU
  return Math.min(MAX_LIGNES_EXPORT, Math.max(1, Math.trunc(demande)))
}

/** Assemble le SQL final : CTE serveur en tete, requete de l'IA en sous-requete, LIMIT impose. */
export function assemblerSql(
  sqlNormalise: string,
  entrees: EntreeCatalogue[],
  ctx: ContexteExecution,
  plafond: number
): Prisma.Sql {
  const ctes = entrees.map(entree => {
    if (!RE_NOM_VUE.test(entree.vue.nom)) throw new Error(`Nom de vue invalide : ${entree.vue.nom}`)
    return Prisma.sql`${Prisma.raw(entree.vue.nom)} AS (${entree.vue.cte(ctx)})`
  })
  const tete = ctes.length > 0 ? Prisma.sql`WITH ${Prisma.join(ctes, ', ')} ` : Prisma.empty
  const limite = Math.trunc(plafond) + 1
  return Prisma.sql`${tete}SELECT * FROM (${Prisma.raw(sqlNormalise)}) AS ${Prisma.raw(ALIAS_RESULTAT)} LIMIT ${Prisma.raw(String(limite))}`
}

/** Types declares par les vues utilisees, par nom de colonne (le premier rencontre gagne). */
function typesDesVues(entrees: EntreeCatalogue[]): Map<string, TypeColonne> {
  const types = new Map<string, TypeColonne>()
  for (const e of entrees)
    for (const c of e.vue.colonnes) if (!types.has(c.nom)) types.set(c.nom, c.type)
  return types
}

/** Noms de colonnes quand aucune ligne n'est revenue : ceux de la requete, etoile developpee si possible. */
function nomsSansLigne(colonnesSortie: string[], entrees: EntreeCatalogue[]): string[] {
  const noms: string[] = []
  for (const nom of colonnesSortie) {
    if (nom !== '*') noms.push(nom)
    else if (entrees.length === 1) noms.push(...entrees[0].vue.colonnes.map(c => c.nom))
  }
  return [...new Set(noms)]
}

/**
 * Controle, execute et met en forme une requete `requete_sql`.
 * Leve `ErreurDonnees` (`sql_interdit`, `sql_erreur`, `sql_delai`) au message court pour le modele.
 */
export async function calculerSql(
  params: ParametresSql,
  ctx: ContexteExecution,
  options?: OptionsCalculSql,
  registre?: Registre
): Promise<ResultatCalcule> {
  const sql = typeof params?.sql === 'string' ? params.sql : ''
  const parNom = new Map((registre ?? await registrePostgres()).map(e => [e.vue.nom.toLowerCase(), e] as const))

  const analyse = analyserSqlDetaille(sql, [...parNom.keys()])
  if (!analyse.ok) throw new ErreurDonnees(analyse.message, 'sql_interdit')

  const entrees = analyse.vues.map(nom => {
    const entree = parNom.get(nom)
    if (!entree) throw new ErreurDonnees(`Vue inconnue : ${nom}.`, 'sql_interdit')
    return entree
  })
  const plafond = plafondLignes(options)
  const delaiMs = Math.max(1, Math.trunc(options?.delaiMs ?? DELAI_SQL_MS))
  const requete = assemblerSql(analyse.sqlNormalise, entrees, ctx, plafond)

  const vues = entrees.map(entree => entree.vue)
  let lecture: Awaited<ReturnType<typeof lireEntrepot>>
  try {
    lecture = await lireEntrepot([requete], vues, delaiMs)
  } catch (erreur) {
    if (erreur instanceof ErreurDonnees) throw erreur
    // Echec sans code SQL (erreur interne, connexion...) : trace serveur reduite au nom de
    // l'erreur et a son code technique, jamais le message ni l'objet (ils peuvent citer des
    // donnees ou la requete) ; rien n'est renvoye au modele.
    const { sqlstate, codePrisma } = extraireErreurPostgres(erreur)
    if (!sqlstate) {
      console.error(
        '[medic-assist/requete_sql] echec inattendu',
        erreur instanceof Error ? erreur.name : typeof erreur,
        codePrisma ?? ''
      )
    }
    throw traduireErreurExecution(
      erreur,
      { vues: entrees.map(e => ({ nom: e.vue.nom, colonnes: e.vue.colonnes.map(c => c.nom) })) },
      delaiMs
    )
  }

  const [brutes] = lecture.resultats
  const tronque = brutes.length > plafond
  const lignes = (tronque ? brutes.slice(0, plafond) : brutes).map(normaliserLigneSql)
  const noms =
    lignes.length > 0 ? Object.keys(lignes[0]) : nomsSansLigne(analyse.colonnesSortie, entrees)
  const colonnes: ColonneJeu[] = infererColonnes(noms, lignes, typesDesVues(entrees))

  // Regles : celles des jeux des vues utilisees (dans la langue du lecteur), puis la lecture seule.
  const regles: string[] = reglesPublication(vues, lecture.publications)
  for (const e of entrees) for (const r of e.jeu.regles) regles.push(libelleDe(r, ctx.locale))
  regles.push(libelleDe(TEXTES_SQL.lectureSeule, ctx.locale))

  const libellesJeux = entrees.map(e => libelleDe(e.jeu.libelle, ctx.locale))
  const provenance: Provenance = {
    source: 'sql',
    ...(entrees.length === 1 ? { jeu: entrees[0].jeu.cle } : {}),
    libelleSource:
      libelleDe(TEXTES_SQL.source, ctx.locale) +
      (libellesJeux.length > 0
        ? ` ${libelleDe(TEXTES_SQL.sur, ctx.locale)} : ${libellesJeux.join(', ')}`
        : ''),
    perimetre: await perimetreLisible(ctx),
    filtres: [],
    regles: [...new Set(regles)],
    sql: sql.trim(),
    calculeA: new Date().toISOString(),
  }

  const colonnesNonAdditives = new Set<string>()
  for (const { jeu, vue } of entrees) {
    if (jeu.temps?.instantane) for (const c of vue.colonnes) colonnesNonAdditives.add(c.nom)
    for (const m of jeu.mesures) if (m.instantane || ['moyenne', 'rapport', 'min', 'max'].includes(m.agregat)) colonnesNonAdditives.add(m.cle)
  }
  return { colonnes, lignes, tronque, provenance, empreinteSource: empreinteEntrees(entrees), colonnesNonAdditives }
}
