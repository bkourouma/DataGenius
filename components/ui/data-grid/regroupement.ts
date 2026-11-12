/**
 * Regroupement facon pivot de la grille.
 *
 * Une colonne declaree `dimension` (pays, grossiste, produit, date...) sert de
 * cle de ligne. Quand l'utilisateur la decoche dans le menu « Colonnes », les
 * lignes qui ne different plus que par des dimensions masquees fusionnent et
 * leurs mesures (`agregat`) se cumulent : masquer produit et grossiste laisse une
 * ligne par pays, comme quand on retire ces champs du pivot.
 *
 * Le regroupement se place apres les filtres (recherche, facettes) et avant le
 * tri et la pagination : on cumule les lignes filtrees, puis on trie les cumuls.
 */

import {
  createRow,
  memo,
  type ColumnDef,
  type Row,
  type RowModel,
  type Table,
  type VisibilityState,
} from "@tanstack/react-table"

import type { DataGridColumnMeta } from "./types"

/** Mesure d'une ligne regroupee : addition, ou fonction propre a la colonne. */
interface MesureRegroupee<TData> {
  id: string
  /** Champ de `original` ou ecrire la valeur, pour les cellules qui le relisent. */
  cle?: string
  agregat: "somme" | ((lignes: TData[]) => unknown)
}

export interface Regroupement<TData> {
  /** Dimensions encore affichees : la cle des lignes regroupees (vide : une seule ligne). */
  dimensions: string[]
  /** Dimensions decochees, sur lesquelles les lignes se cumulent. */
  dimensionsMasquees: string[]
  /** Colonnes ni dimension ni mesure, masquees le temps du regroupement. */
  nonCumulables: string[]
  mesures: MesureRegroupee<TData>[]
  /** Champs de `original` additionnes sur la ligne fusionnee. */
  champs: string[]
  /** Resume stable du regroupement : il ne se recalcule que s'il change. */
  signature: string
}

/** Colonnes feuilles : un en-tete de groupe ne porte pas de valeur. */
function feuilles<TData>(columns: ColumnDef<TData, unknown>[]): ColumnDef<TData, unknown>[] {
  return columns.flatMap((column) =>
    "columns" in column && Array.isArray(column.columns) ? feuilles(column.columns) : [column]
  )
}

function idDe<TData>(column: ColumnDef<TData, unknown>): string | undefined {
  return column.id ?? ("accessorKey" in column ? String(column.accessorKey) : undefined)
}

/** Champ lu directement dans `original` (pas de chemin imbrique `a.b`). */
function champDe<TData>(column: ColumnDef<TData, unknown>): string | undefined {
  if (!("accessorKey" in column)) return undefined
  const cle = String(column.accessorKey)
  return cle.includes(".") ? undefined : cle
}

/**
 * Regroupement demande par la visibilite choisie, ou `null` si aucune dimension
 * n'est decochee. Seuls les choix explicites comptent : une colonne masquee par
 * defaut sur telephone (`priorite: 'basse'`) ne declenche pas de cumul.
 */
export function calculerRegroupement<TData>(
  columns: ColumnDef<TData, unknown>[],
  visibiliteChoisie: VisibilityState,
  champsCumules: readonly string[] = []
): Regroupement<TData> | null {
  const colonnes = feuilles(columns)
  const metaDe = (column: ColumnDef<TData, unknown>) => column.meta as DataGridColumnMeta<TData> | undefined

  const dimensions: string[] = []
  const dimensionsMasquees: string[] = []
  for (const column of colonnes) {
    const id = idDe(column)
    if (!id || !metaDe(column)?.dimension) continue
    if (visibiliteChoisie[id] === false) dimensionsMasquees.push(id)
    else dimensions.push(id)
  }
  if (dimensionsMasquees.length === 0) return null

  const nonCumulables: string[] = []
  const mesures: MesureRegroupee<TData>[] = []
  const champs = new Set(champsCumules)
  for (const column of colonnes) {
    const id = idDe(column)
    const meta = metaDe(column)
    if (!id || meta?.dimension) continue
    const agregat = meta?.agregat
    if (agregat === "recalcul") continue
    if (!agregat) {
      nonCumulables.push(id)
      continue
    }
    const cle = champDe(column)
    mesures.push({ id, cle, agregat })
    if (agregat === "somme" && cle) champs.add(cle)
  }

  return {
    dimensions,
    dimensionsMasquees,
    nonCumulables,
    mesures,
    champs: [...champs],
    signature: JSON.stringify([dimensions, mesures.map((mesure) => mesure.id), [...champs]]),
  }
}

/**
 * Somme de valeurs heterogenes (nombres, decimaux serialises en texte). Les
 * vides sont ignores ; si tout est vide, on garde la premiere valeur telle
 * quelle pour que la cellule affiche ce qu'elle affichait deja (tiret, zero...).
 */
export function sommer(valeurs: readonly unknown[]): unknown {
  let total = 0
  let compte = false
  for (const valeur of valeurs) {
    if (valeur === null || valeur === undefined || valeur === "") continue
    const nombre = typeof valeur === "number" ? valeur : Number(valeur)
    if (!Number.isFinite(nombre)) continue
    total += nombre
    compte = true
  }
  // 15 chiffres significatifs : retire le bruit des flottants (0,1 + 0,2).
  return compte ? Number(total.toPrecision(15)) : valeurs[0]
}

/** Cle d'une valeur de dimension : une date se compare par sa valeur, pas par son objet. */
function cleValeur(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "∅"
  if (valeur instanceof Date) return `d:${valeur.getTime()}`
  if (typeof valeur === "object") return `o:${JSON.stringify(valeur)}`
  return `${typeof valeur}:${String(valeur)}`
}

/** Fusionne les lignes d'un groupe en une seule, mesures cumulees. */
function regrouperLignes<TData>(
  table: Table<TData>,
  rowModel: RowModel<TData>,
  regroupement: Regroupement<TData>
): RowModel<TData> {
  const groupes = new Map<string, Row<TData>[]>()
  for (const row of rowModel.rows) {
    const cle = regroupement.dimensions.map((id) => cleValeur(row.getValue(id))).join("\u001f")
    const groupe = groupes.get(cle)
    if (groupe) groupe.push(row)
    else groupes.set(cle, [row])
  }

  const rows: Row<TData>[] = []
  for (const [cle, lignes] of groupes) {
    const originaux = lignes.map((ligne) => ligne.original)
    const valeurs: Record<string, unknown> = {}
    const ecrits: Record<string, unknown> = {}
    for (const mesure of regroupement.mesures) {
      const valeur =
        mesure.agregat === "somme"
          ? sommer(lignes.map((ligne) => ligne.getValue(mesure.id)))
          : mesure.agregat(originaux)
      valeurs[mesure.id] = valeur
      if (mesure.cle) ecrits[mesure.cle] = valeur
    }

    // La ligne fusionnee part de la premiere ligne du groupe (dimensions
    // affichees identiques), champs cumules additionnes : une cellule qui lit
    // `row.original.montant` y trouve donc le cumul.
    const original: Record<string, unknown> = { ...(originaux[0] as Record<string, unknown>) }
    for (const champ of regroupement.champs) {
      original[champ] = sommer(originaux.map((ligne) => (ligne as Record<string, unknown>)[champ]))
    }
    Object.assign(original, ecrits)

    const row = createRow(table, `__groupe:${cle}`, original as TData, rows.length, 0)
    for (const id of regroupement.dimensions) row._valuesCache[id] = lignes[0].getValue(id)
    // Les colonnes « recalcul » ne sont pas mises en cache : leur `accessorFn`
    // relit la ligne fusionnee, donc des champs deja cumules.
    Object.assign(row._valuesCache, valeurs)
    rows.push(row)
  }

  return {
    rows,
    flatRows: rows,
    rowsById: Object.fromEntries(rows.map((row) => [row.id, row])),
  }
}

/**
 * Modele de lignes regroupees, branche a la place du regroupement TanStack
 * (qui produit un arbre et garde la premiere ligne comme `original`). `lire`
 * renvoie le regroupement en cours : la fabrique n'est creee qu'une fois par
 * TanStack, elle doit donc relire l'etat a chaque calcul.
 */
export function getRegroupedRowModel<TData>(
  lire: () => { regroupement: Regroupement<TData> | null; fusionner: boolean }
): (table: Table<TData>) => () => RowModel<TData> {
  return (table) =>
    memo(
      () => {
        const { regroupement, fusionner } = lire()
        return [table.getPreGroupedRowModel(), fusionner ? (regroupement?.signature ?? null) : null] as const
      },
      (rowModel, signature) => {
        const { regroupement } = lire()
        if (signature === null || !regroupement || rowModel.rows.length === 0) return rowModel
        return regrouperLignes(table, rowModel, regroupement)
      },
      { key: "regroupement", debug: () => false }
    )
}
