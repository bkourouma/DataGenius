/**
 * Construction du SQL d'une requete semantique VALIDEE.
 *
 *   WITH <vue> AS (<vue.cte(ctx)>)
 *   SELECT <dimensions>, (<mesure>)::float8 AS "<cle>"
 *   FROM <vue> WHERE <periode> AND <filtres>
 *   GROUP BY <dimensions> ORDER BY <tri> LIMIT <limite + 1>
 *
 * SECURITE : identifiants (vue, alias) et expressions viennent UNIQUEMENT du catalogue,
 * choisis par cle ; aucune chaine de la requete n'entre dans le texte SQL. Les valeurs
 * (bornes de periode, valeurs de filtres) passent par Prisma.sql, donc en parametres.
 *
 * EXACTITUDE : le moteur ne fait que `::float8` sur l'expression d'agregat du catalogue,
 * qui porte l'arrondi. Les totaux relancent les MEMES expressions sans GROUP BY, sur les
 * memes filtres : un rapport (taux) reste un rapport de sommes, jamais une somme de taux.
 */

import { Prisma } from '@prisma/client'

import type { ColonneJeu, ContexteExecution } from '@/lib/medic-assist/contrats'
import { libelleDe } from '../catalogue/communs'
import type {
  DefinitionDimension,
  DefinitionMesure,
  EntreeCatalogue,
  RequeteNormalisee,
} from '../catalogue/types'
import type { RequeteValidee, SensTri } from '../catalogue/validation'
import { MAX_LIGNES_EXPORT, MAX_LIGNES_JEU } from '../types'
import { dimensionsSelectionnees, estTemporelle } from './temps'

/** Lignes rendues quand la requete ne fixe pas de limite. */
export const LIMITE_DEFAUT = 1_000

export interface OptionsConstruction {
  /**
   * Plafond de lignes (defaut MAX_LIGNES_JEU, au plus MAX_LIGNES_EXPORT). Donne sans
   * `limite` dans la requete, il devient la limite (export complet) ; sinon il borne la
   * limite demandee.
   */
  limiteLignes?: number
}

export interface SqlConstruit {
  /** Requete principale ; elle demande `limite + 1` lignes pour detecter la troncature. */
  principal: Prisma.Sql
  /** Totaux des mesures totalisables, sans GROUP BY ; null si sans objet (voir `mesuresTotalisees`). */
  totaux: Prisma.Sql | null
  colonnes: ColonneJeu[]
  dimensions: DefinitionDimension[]
  mesures: DefinitionMesure[]
  /**
   * Mesures dont le total a un sens : toutes, sauf les instantanees (stock) quand plusieurs
   * mois sont couverts. Sans dimension, la ligne unique EST le total (`totaux` vaut null).
   */
  mesuresTotalisees: string[]
  /** Tri effectif complet (demande, defaut, puis departage par les dimensions). */
  tri: { cle: string; sens: SensTri }[]
  /** Nombre maximal de lignes rendues. */
  limite: number
}

type Normalisee = RequeteNormalisee & Partial<Pick<RequeteValidee, 'tri' | 'limite'>>

const MOTIF_ALIAS = /^[a-z][a-z0-9_]*$/
const MOTIF_VUE = /^mv_[a-z0-9_]+$/

/** Alias de colonne entre guillemets ; la cle vient du catalogue, on la verifie quand meme. */
function alias(cle: string): Prisma.Sql {
  if (!MOTIF_ALIAS.test(cle)) throw new Error(`Cle de catalogue invalide : ${cle}`)
  return Prisma.raw(`"${cle}"`)
}

/** Expression du catalogue, entre parentheses ; refuse ce qui ressemble a une injection. */
function expression(texte: string): Prisma.Sql {
  if (!texte.trim() || /;|--|\/\*/.test(texte)) throw new Error('Expression de catalogue invalide')
  return Prisma.raw(`(${texte})`)
}

function bornerLimite(normalisee: Normalisee, options: OptionsConstruction): number {
  const plafond = Math.min(
    Math.max(1, Math.trunc(options.limiteLignes ?? MAX_LIGNES_JEU)),
    MAX_LIGNES_EXPORT
  )
  if (normalisee.limite !== undefined) return Math.min(Math.trunc(normalisee.limite), plafond)
  if (options.limiteLignes !== undefined) return plafond
  return Math.min(LIMITE_DEFAUT, plafond)
}

/**
 * Tri effectif. Demande : tel quel. Defaut avec mesures : dimensions temporelles
 * croissantes, puis premiere mesure decroissante. Simple liste : dimensions de A a Z.
 * Les dimensions restantes departagent toujours (croissant), pour un ordre total et donc
 * une troncature reproductible.
 */
export function triEffectif(
  demande: readonly { cle: string; sens: SensTri }[],
  dimensions: readonly DefinitionDimension[],
  mesures: readonly DefinitionMesure[]
): { cle: string; sens: SensTri }[] {
  if (dimensions.length === 0) return []
  const tri: { cle: string; sens: SensTri }[] = []
  const ajouter = (cle: string, sens: SensTri) => {
    if (!tri.some(t => t.cle === cle)) tri.push({ cle, sens })
  }
  for (const t of demande) ajouter(t.cle, t.sens)
  if (demande.length === 0 && mesures.length > 0) {
    for (const d of dimensions) if (estTemporelle(d)) ajouter(d.cle, 'asc')
    ajouter(mesures[0].cle, 'desc')
  }
  for (const d of dimensions) ajouter(d.cle, 'asc')
  return tri
}

/** Construit le SQL principal, celui des totaux et la description des colonnes. */
export function construireSql(
  normalisee: Normalisee,
  entree: EntreeCatalogue,
  ctx: ContexteExecution,
  options: OptionsConstruction = {}
): SqlConstruit {
  const { jeu, vue } = entree
  if (!MOTIF_VUE.test(vue.nom)) throw new Error(`Nom de vue invalide : ${vue.nom}`)

  const dimensions = dimensionsSelectionnees(jeu, normalisee.dimensions, normalisee.granularite)
  const mesures = normalisee.mesures.map(cle => {
    const mesure = jeu.mesures.find(m => m.cle === cle)
    if (!mesure) throw new Error(`Mesure non validee : ${cle}`)
    return mesure
  })

  // WHERE : periode (bornes incluses, 'YYYY-MM' se compare comme du texte), puis les filtres
  // dans l'ordre du catalogue, pour un texte SQL stable.
  const conditions: Prisma.Sql[] = []
  if (normalisee.periode) {
    conditions.push(
      Prisma.sql`periode BETWEEN ${normalisee.periode.debut} AND ${normalisee.periode.fin}`
    )
  }
  for (const filtre of jeu.filtres) {
    const valeur = normalisee.filtres[filtre.cle]
    if (valeur === undefined) continue
    conditions.push(Prisma.sql`(${filtre.condition(valeur, ctx)})`)
  }

  const nomVue = Prisma.raw(vue.nom)
  const avec = Prisma.sql`WITH ${nomVue} AS (${vue.cte(ctx)})`
  const where =
    conditions.length > 0 ? Prisma.sql` WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty

  const colonnesDimensions = dimensions.map(
    d => Prisma.sql`${expression(d.expression)} AS ${alias(d.cle)}`
  )
  const colonneMesure = (m: DefinitionMesure) => typeof m.expression === 'string'
    ? Prisma.sql`${expression(m.expression)}::float8 AS ${alias(m.cle)}`
    : Prisma.sql`(${m.expression}) AS ${alias(m.cle)}`
  const select = Prisma.join([...colonnesDimensions, ...mesures.map(colonneMesure)], ', ')

  const tri = triEffectif(normalisee.tri ?? [], dimensions, mesures)
  const limite = bornerLimite(normalisee, options)

  let principal: Prisma.Sql
  if (dimensions.length === 0) {
    // Agregat global : une seule ligne, ni tri ni limite.
    principal = Prisma.sql`${avec} SELECT ${select} FROM ${nomVue}${where}`
  } else {
    const groupBy = Prisma.join(
      dimensions.map(d => expression(d.expression)),
      ', '
    )
    // ORDER BY par alias de sortie : en Postgres un nom simple designe d'abord la colonne
    // de sortie, meme si la vue a une colonne du meme nom.
    const orderBy = Prisma.join(
      tri.map(
        t =>
          Prisma.sql`${alias(t.cle)} ${Prisma.raw(t.sens === 'desc' ? 'DESC' : 'ASC')} NULLS LAST`
      ),
      ', '
    )
    // Entier calcule par le code (borne ci-dessus), pas une valeur de la requete.
    const limiteSql = Prisma.raw(String(limite + 1))
    principal = Prisma.sql`${avec} SELECT ${select} FROM ${nomVue}${where} GROUP BY ${groupBy} ORDER BY ${orderBy} LIMIT ${limiteSql}`
  }

  // Totaux : une mesure instantanee (stock) ne se totalise que sur un seul mois.
  const unSeulMois = (jeu.instantanePar !== undefined && typeof normalisee.filtres[jeu.instantanePar] === 'string') ||
    (normalisee.periode !== null && normalisee.periode.debut === normalisee.periode.fin)
  const instantaneJeu = Boolean(jeu.temps?.instantane)
  const totalisables = mesures.filter(m => unSeulMois || !(m.instantane || instantaneJeu))
  const totaux =
    dimensions.length > 0 && totalisables.length > 0
      ? Prisma.sql`${avec} SELECT ${Prisma.join(totalisables.map(colonneMesure), ', ')} FROM ${nomVue}${where}`
      : null

  const colonnes: ColonneJeu[] = [
    ...dimensions.map(d => ({
      cle: d.cle,
      libelle: libelleDe(d.libelle, ctx.locale),
      type: d.type,
    })),
    ...mesures.map(m => ({
      cle: m.cle,
      libelle: libelleDe(m.libelle, ctx.locale),
      type: m.type,
      ...(m.unite ? { unite: m.unite } : {}),
    })),
  ]

  return {
    principal,
    totaux,
    colonnes,
    dimensions,
    mesures,
    mesuresTotalisees: totalisables.map(m => m.cle),
    tri,
    limite,
  }
}
