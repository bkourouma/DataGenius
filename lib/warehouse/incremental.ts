import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { citer, identifiant, typeSql, type JeuEntrepot } from './configuration'
import { transactionLectureUrl } from './postgres'
import type { LigneImport } from './qualite'
import { urlSource } from './sources-admin'

const MAX_LIGNES = 100_000
const MAX_OCTETS = 20 * 1024 * 1024

export const DefinitionIncrementale = z.strictObject({
  cles: z.array(identifiant).min(1).max(6),
  dateModification: identifiant,
  chevauchementMinutes: z.number().int().min(0).max(1440),
  reconciliationMinutes: z.number().int().min(1).max(43200),
})
export type DefinitionIncrementale = z.infer<typeof DefinitionIncrementale>

export type EtatIncremental = {
  version: number
  definition: unknown
  empreinte: string | null
  contenu: LigneImport[] | null
  curseur: string | null
  reconcilie_a: Date | null
}

export class ErreurIncrementale extends Error {
  constructor(public code: 'incremental_cle' | 'incremental_date' | 'volume' | 'configuration', message: string) {
    super(message)
  }
}

export function validerDefinitionIncrementale(entree: JeuEntrepot, definition: unknown) {
  const resultat = DefinitionIncrementale.safeParse(definition)
  if (!resultat.success || entree.source.type !== 'postgresql' || entree.source.connexion) {
    throw new ErreurIncrementale('configuration', 'Configurez la lecture incrémentale sur un import PostgreSQL administré.')
  }
  const { cles, dateModification } = resultat.data
  const colonnes = new Map(entree.jeu.colonnes.map(c => [c.nom, c]))
  if (new Set(cles).size !== cles.length ||
      cles.some(c => !['texte', 'entier', 'date'].includes(colonnes.get(c)?.type ?? '')) ||
      !colonnes.has(dateModification) || cles.includes(dateModification)) {
    throw new ErreurIncrementale('configuration', 'Sélectionnez des clés stables et une colonne de modification distincte.')
  }
  return resultat.data
}

async function typeCurseur(tx: Prisma.TransactionClient, entree: JeuEntrepot, definition: DefinitionIncrementale) {
  const colonne = entree.jeu.colonnes.find(c => c.nom === definition.dateModification)!
  const [champ] = await tx.$queryRaw<{ type: string }[]>`
    SELECT t.typname::text AS type
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    WHERE n.nspname = ${entree.jeu.schema} AND c.relname = ${entree.jeu.table}
      AND a.attname = ${colonne.origine ?? colonne.nom} AND NOT a.attisdropped
      AND t.typnamespace = 'pg_catalog'::regnamespace
  `
  if (!champ || !['timestamp', 'timestamptz'].includes(champ.type)) {
    throw new ErreurIncrementale('incremental_date', 'La date de modification doit être un horodatage PostgreSQL.')
  }
  return { champ: citer(colonne.origine ?? colonne.nom), avecFuseau: champ.type === 'timestamptz' }
}

export async function verifierCurseur(entree: JeuEntrepot, definition: DefinitionIncrementale) {
  await transactionLectureUrl(await urlSource(entree.source.id), tx => typeCurseur(tx, entree, definition))
}

function cleLigne(ligne: LigneImport, cles: string[]) {
  const valeurs = cles.map(c => ligne[c])
  if (valeurs.some(valeur => valeur === null || valeur === undefined)) {
    throw new ErreurIncrementale('incremental_cle', 'Une ligne possède une clé incrémentale vide.')
  }
  return JSON.stringify(valeurs)
}

export async function lireIncremental(entree: JeuEntrepot, etat: EtatIncremental, forcerReconciliation: boolean) {
  const { jeu, empreinte } = entree
  const definition = validerDefinitionIncrementale(entree, etat.definition)
  const reconciliation = forcerReconciliation || etat.empreinte !== empreinte || !etat.contenu || !etat.curseur ||
    !etat.reconcilie_a || Date.now() - etat.reconcilie_a.getTime() >= definition.reconciliationMinutes * 60_000
  const limite = reconciliation ? null : etat.curseur
  const [lecture] = await transactionLectureUrl(await urlSource(entree.source.id), async tx => {
    const { champ, avecFuseau } = await typeCurseur(tx, entree, definition)
    const minimum = Prisma.sql`(${limite}::timestamptz - ${definition.chevauchementMinutes}::int * interval '1 minute')`
    const comparaison = avecFuseau ? minimum : Prisma.sql`(${minimum} AT TIME ZONE 'UTC')`
    const filtre = limite ? Prisma.sql`WHERE ${champ} >= ${comparaison} OR ${champ} IS NULL OR ${champ} = '-infinity'` : Prisma.empty
    const utc = avecFuseau ? Prisma.sql`${champ} AT TIME ZONE 'UTC'` : champ
    const colonnes = jeu.colonnes.map(c => Prisma.sql`(${citer(c.origine ?? c.nom)}::${typeSql(c.type)})::text AS ${citer(c.nom)}`)
    return tx.$queryRaw<{ lignes: number; contenu: string | null; curseur: string | null; date_invalide: boolean }[]>`
      WITH source AS MATERIALIZED (
        SELECT ${Prisma.join(colonnes)},
          CASE WHEN isfinite(${champ}) THEN ${utc} END AS "__dg_date"
        FROM ${citer(jeu.schema)}.${citer(jeu.table)} ${filtre}
        LIMIT ${MAX_LIGNES + 1}
      ), selection AS MATERIALIZED (
        SELECT (to_jsonb(source) - '__dg_date')::text AS ligne, "__dg_date" FROM source
      ), volume AS (
        SELECT count(*)::int AS lignes, coalesce(sum(octet_length(ligne)::bigint + 1), 0) AS octets,
          max("__dg_date") AS date_max, coalesce(bool_or("__dg_date" IS NULL), false) AS date_invalide
        FROM selection
      )
      SELECT lignes, CASE WHEN lignes <= ${MAX_LIGNES} AND octets <= ${MAX_OCTETS - 2}
        THEN '[' || coalesce((SELECT string_agg(ligne, ',') FROM selection), '') || ']' END AS contenu,
        to_char(date_max, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS curseur, date_invalide
      FROM volume
    `
  })
  if (!lecture?.contenu) throw new ErreurIncrementale('volume', 'Volume maximal de synchronisation dépassé.')
  if (lecture.date_invalide || (lecture.curseur && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(lecture.curseur))) {
    throw new ErreurIncrementale('incremental_date', 'Une date de modification est absente ou invalide.')
  }
  const parCle = new Map<string, LigneImport>()
  if (!reconciliation) for (const ligne of etat.contenu ?? []) parCle.set(cleLigne(ligne, definition.cles), ligne)
  const clesLues = new Set<string>()
  for (const ligne of JSON.parse(lecture.contenu) as LigneImport[]) {
    const cle = cleLigne(ligne, definition.cles)
    if (clesLues.has(cle)) throw new ErreurIncrementale('incremental_cle', 'Une clé incrémentale apparaît plusieurs fois.')
    clesLues.add(cle)
    parCle.set(cle, ligne)
  }
  const lignes = [...parCle.values()].map(ligne => JSON.stringify(ligne)).sort()
  const contenu = '[' + lignes.join(',') + ']'
  if (lignes.length > MAX_LIGNES || Buffer.byteLength(contenu) > MAX_OCTETS) {
    throw new ErreurIncrementale('volume', 'Volume maximal de synchronisation dépassé.')
  }
  const curseur = reconciliation ? lecture.curseur :
    [etat.curseur, lecture.curseur].filter((c): c is string => c !== null).sort().at(-1) ?? null
  return { lignes: lignes.length, lignesLues: lecture.lignes, contenu, curseur, reconciliation }
}
