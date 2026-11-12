"use client"

/**
 * Grille de donnees de l'application.
 *
 * Un seul composant pour toutes les listes : recherche, filtres, tri multiple,
 * colonnes masquables et redimensionnables, densite, selection, defilement de
 * toutes les lignes, export CSV/Excel et plein ecran. Les preferences d'affichage
 * sont memorisees par grille (voir `useGridPreferences`).
 *
 * Pas de pages : toutes les lignes defilent sous un en-tete colle. Le tri et le
 * filtrage se font cote client sur la totalite des lignes passees par la page.
 * Une page qui charge ses lignes par paquets aupres du serveur (`chargerSuite`)
 * recoit la demande du paquet suivant quand on arrive au bas de la liste.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ExpandedState,
  type FilterFn,
  type Row,
  type SortingFn,
  type SortingState,
  type Table,
  type Updater,
  type VisibilityState,
} from "@tanstack/react-table"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Check,
  Inbox,
  Layers,
  Loader2,
  SearchX,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useIsMobile } from "@/hooks/use-media-query"
import { exportRowsToCsv, exportRowsToExcel, type OptionsColonne } from "@/lib/client/export-utils"
import { trierCellules } from "@/lib/tri/libelles"
import { DataGridToolbar } from "./data-grid-toolbar"
import { calculerRegroupement, getRegroupedRowModel } from "./regroupement"
import { useGridPreferences } from "./use-grid-preferences"
import type { DataGridColumnMeta, DataGridEmptyState, DataGridProps, GridDensity } from "./types"

/**
 * Lignes dessinees d'un coup : la grille n'a pas de pages, toutes les lignes
 * defilent, mais elle n'ajoute les suivantes au DOM qu'a l'approche du bas de
 * la liste. Quelques milliers de lignes dessinees d'emblee figeraient un
 * telephone ; le tri, le filtre, l'export et les totaux portent toujours sur
 * l'ensemble des lignes.
 */
const LOT_LIGNES = 100

/**
 * Hauteur minimale de la zone defilante sur telephone : la hauteur maximale
 * propre a chaque page (souvent « ecran moins l'en-tete de page ») laisserait
 * a peine quelques lignes visibles sur un petit ecran.
 */
const PLANCHER_MOBILE = "min(28rem,70dvh)"

/** Hauteur des cellules selon la densite choisie. */
const DENSITY_CLASSES: Record<GridDensity, string> = {
  compact: "px-3 py-1.5",
  normal: "px-3 py-2.5",
  comfortable: "px-4 py-4",
}

const ALIGN_CLASSES = {
  start: "text-start",
  center: "text-center",
  end: "text-end",
} as const

/**
 * Minuscules sans accents : « Côte d'Ivoire » doit se trouver en tapant
 * « cote ivoire », sinon la recherche parait cassee aux utilisateurs francophones.
 */
function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

/** Recherche libre : toute colonne visible contenant le texte fait correspondre la ligne. */
const globalSearchFilter: FilterFn<unknown> = (row, _columnId, filterValue) => {
  const needle = normalizeText(filterValue).trim()
  if (!needle) return true
  return row.getAllCells().some((cell) => {
    if (!cell.column.getIsVisible()) return false
    if ((cell.column.columnDef.meta as DataGridColumnMeta<unknown> | undefined)?.system) return false
    return normalizeText(cell.getValue()).includes(needle)
  })
}

const SELECTION_COLUMN_ID = "__selection"
const EXPANDER_COLUMN_ID = "__expander"

/**
 * Style d'une cellule : largeur eventuelle et, pour une colonne collee, sa
 * distance au bord. On passe par `insetInlineStart` plutot que par une classe
 * Tailwind pour que le decalage s'inverse de lui-meme en ecriture arabe.
 */
function cellStyle(
  // Seules les proprietes de mise en page comptent ici : le parametre de type de
  // `DataGridColumnMeta` ne concerne que `exportValue`, jamais lu dans ce calcul.
  meta: Pick<DataGridColumnMeta<never>, "sticky" | "stickyOffset"> | undefined,
  width: number | undefined
): React.CSSProperties | undefined {
  const style: React.CSSProperties = {}
  if (width !== undefined) style.width = width
  if (meta?.sticky === "start") style.insetInlineStart = meta.stickyOffset ?? 0
  if (meta?.sticky === "end") style.insetInlineEnd = meta.stickyOffset ?? 0
  return Object.keys(style).length > 0 ? style : undefined
}

/** Cellule sans valeur exploitable : celles que `trierCellules` range en dernier. */
function celluleVide(valeur: unknown): boolean {
  return (
    valeur === null ||
    valeur === undefined ||
    (typeof valeur === "string" && valeur.trim() === "") ||
    (typeof valeur === "number" && Number.isNaN(valeur)) ||
    (valeur instanceof Date && Number.isNaN(valeur.getTime()))
  )
}

/** Identifiant d'une definition de colonne, tel que TanStack le calcule. */
function columnIdOf<TData>(column: ColumnDef<TData, unknown>): string | undefined {
  return column.id ?? ("accessorKey" in column ? String(column.accessorKey) : undefined)
}

/** Libelle d'une colonne : `meta.label`, sinon un en-tete texte ; absent pour une colonne d'actions. */
function columnLabelOf<TData>(column: Column<TData, unknown>): string | undefined {
  const meta = column.columnDef.meta as DataGridColumnMeta<TData> | undefined
  if (meta?.label) return meta.label
  const header = column.columnDef.header
  return typeof header === "string" && header ? header : undefined
}

/* -------------------------------------------------------------------------- */
/* Etats partages entre la vue tableau et la vue cartes                        */
/* -------------------------------------------------------------------------- */

function GridLoadingState() {
  const t = useTranslations("common.dataGrid")
  return (
    <div className="flex flex-col items-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm">{t("loading")}</p>
    </div>
  )
}

function GridErrorState({ error }: { error: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="text-sm font-medium text-destructive">{error}</p>
    </div>
  )
}

function GridEmptyState({
  hasFilters,
  emptyState,
  onResetFilters,
}: {
  hasFilters: boolean
  emptyState: DataGridEmptyState | undefined
  onResetFilters: () => void
}) {
  const t = useTranslations("common.dataGrid")
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {hasFilters ? (
        <>
          <SearchX className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium">{t("noMatch")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("noMatchHint")}</p>
          <Button variant="outline" size="sm" className="mt-1" onClick={onResetFilters}>
            {t("resetFilters")}
          </Button>
        </>
      ) : (
        <>
          <Inbox className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium">{emptyState?.title ?? t("empty")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {emptyState?.description ?? t("emptyHint")}
          </p>
          {emptyState?.action && <div className="mt-2">{emptyState.action}</div>}
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Vue cartes (petit ecran)                                                    */
/* -------------------------------------------------------------------------- */

/** Menu « Trier par » : les en-tetes de colonne n'existent plus en vue cartes. */
function GridSortMenu<TData>({
  table,
  triInitial,
}: {
  table: Table<TData>
  triInitial: SortingState | undefined
}) {
  const t = useTranslations("common.dataGrid")
  const tv = useTranslations("common.visibilite")
  const sortableColumns = table.getAllLeafColumns().filter((column) => column.getCanSort())
  if (sortableColumns.length === 0) return null

  const current = table.getState().sorting[0]
  // « Effacer le tri » ramene au tri par defaut : inutile de le proposer quand
  // c'est deja le tri en cours.
  const sortingCourant = table.getState().sorting
  const dejaTriParDefaut =
    triInitial !== undefined &&
    triInitial.length > 0 &&
    sortingCourant.length === triInitial.length &&
    sortingCourant.every((entree, i) => entree.id === triInitial[i].id && entree.desc === triInitial[i].desc)
  const currentColumn = current ? sortableColumns.find((column) => column.id === current.id) : undefined
  const directionTitle = current && !current.desc ? t("sortDesc") : t("sortAsc")

  return (
    <div className="flex items-center gap-2 border-b bg-white px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-11 min-w-0 flex-1 justify-between gap-2">
            <span className="shrink-0">{tv("trierPar")}</span>
            {currentColumn && (
              <span className="truncate font-normal text-muted-foreground">
                {columnLabelOf(currentColumn) ?? currentColumn.id}
              </span>
            )}
            <ChevronDown className="ms-auto h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-60 overflow-y-auto">
          {sortableColumns.map((column) => (
            <DropdownMenuItem
              key={column.id}
              className="min-h-11"
              onSelect={() =>
                table.setSorting([
                  { id: column.id, desc: current?.id === column.id ? current.desc : false },
                ])
              }
            >
              <span className="flex-1 truncate">{columnLabelOf(column) ?? column.id}</span>
              {current?.id === column.id && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          ))}
          {current && !dejaTriParDefaut && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-11" onSelect={() => table.resetSorting(true)}>
                {t("sortClear")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="outline"
        size="sm"
        className="h-11 w-11 shrink-0 p-0"
        disabled={!current}
        title={directionTitle}
        aria-label={directionTitle}
        onClick={() => current && table.setSorting([{ id: current.id, desc: !current.desc }])}
      >
        {!current ? (
          <ArrowUpDown className="h-4 w-4 text-slate-300" />
        ) : current.desc ? (
          <ArrowDown className="h-4 w-4 text-primary" />
        ) : (
          <ArrowUp className="h-4 w-4 text-primary" />
        )}
      </Button>
    </div>
  )
}

/** Une carte par ligne, a la place du tableau. */
function GridCards<TData>({
  table,
  rows,
  onRowClick,
  getRowClassName,
  renderExpandedRow,
  showTotals,
}: {
  table: Table<TData>
  rows: Row<TData>[]
  onRowClick?: (row: TData) => void
  getRowClassName?: (row: TData) => string | undefined
  renderExpandedRow?: (row: TData) => React.ReactNode
  showTotals: boolean
}) {
  const tv = useTranslations("common.visibilite")

  const metaOf = (column: Column<TData, unknown>) =>
    column.columnDef.meta as DataGridColumnMeta<TData> | undefined
  const alignClass = (align: DataGridColumnMeta<TData>["align"]) =>
    align === "end" ? "text-end" : align === "center" ? "text-center" : "text-start"

  // Colonnes candidates : visibles, non systeme, et pas reservees aux grands ecrans.
  const contentColumns = table
    .getVisibleLeafColumns()
    .filter((column) => !metaOf(column)?.system && !metaOf(column)?.hideOnMobile)
  const titleColumn =
    contentColumns.find((column) => metaOf(column)?.carteTitre) ??
    contentColumns.find((column) => columnLabelOf(column) !== undefined) ??
    contentColumns[0]

  const totals = showTotals
    ? table
        .getFooterGroups()
        .flatMap((group) => group.headers)
        .filter(
          (header) =>
            !header.isPlaceholder &&
            header.column.getIsVisible() &&
            header.column.columnDef.footer &&
            !metaOf(header.column)?.system
        )
    : []

  return (
    <ul role="list" className="flex flex-col gap-2 p-3">
      {rows.map((row) => {
        type Cell = ReturnType<typeof row.getVisibleCells>[number]
        const headCells: Cell[] = []
        const bodyCells: Cell[] = []
        const footCells: Cell[] = []
        let titleCell: Cell | undefined

        row.getVisibleCells().forEach((cell) => {
          const column = cell.column
          const meta = metaOf(column)
          if (column.id === SELECTION_COLUMN_ID || column.id === EXPANDER_COLUMN_ID) {
            headCells.push(cell)
          } else if (meta?.hideOnMobile) {
            // Meme regle que la vue tableau : colonne reservee aux grands ecrans.
          } else if (titleColumn && column.id === titleColumn.id) {
            titleCell = cell
          } else if (meta?.system || columnLabelOf(column) === undefined) {
            footCells.push(cell)
          } else {
            bodyCells.push(cell)
          }
        })

        const onKeyDown = onRowClick
          ? (event: React.KeyboardEvent<HTMLDivElement>) => {
              // Les touches destinees a un bouton ou une case de la carte lui restent.
              if (event.target !== event.currentTarget) return
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onRowClick(row.original)
              }
            }
          : undefined

        return (
          <li key={row.id} style={row.depth > 0 ? { paddingInlineStart: row.depth * 12 } : undefined}>
            <div
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              onKeyDown={onKeyDown}
              data-state={row.getIsSelected() ? "selected" : undefined}
              className={cn(
                "rounded-lg border p-3 text-sm",
                row.getIsSelected() ? "bg-primary/5" : "bg-white",
                onRowClick &&
                  "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                getRowClassName?.(row.original)
              )}
            >
              {(titleCell || headCells.length > 0) && (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 break-words font-semibold">
                    {titleCell && flexRender(titleCell.column.columnDef.cell, titleCell.getContext())}
                  </div>
                  {headCells.length > 0 && (
                    <div className="flex shrink-0 items-center gap-1">
                      {headCells.map((cell) => (
                        <React.Fragment key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {bodyCells.length > 0 && (
                <dl className="mt-2 flex flex-col gap-1.5">
                  {bodyCells.map((cell) => {
                    const meta = metaOf(cell.column)
                    return (
                      <div key={cell.id} className="flex items-center justify-between gap-3">
                        <dt className="max-w-[45%] shrink-0 text-xs text-muted-foreground">
                          {columnLabelOf(cell.column)}
                        </dt>
                        <dd
                          className={cn(
                            "m-0 min-w-0 break-words tabular-nums",
                            alignClass(meta?.align),
                            meta?.cellClassName
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              )}

              {footCells.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                  {footCells.map((cell) => (
                    <React.Fragment key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>

            {renderExpandedRow && row.getIsExpanded() && (
              <div className="mt-1 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                {renderExpandedRow(row.original)}
              </div>
            )}
          </li>
        )
      })}

      {totals.length > 0 && (
        <li>
          <div className="rounded-lg border bg-slate-100 p-3 text-sm font-semibold text-slate-800">
            <p className="text-xs uppercase tracking-wide text-slate-600">{tv("totaux")}</p>
            <dl className="mt-2 flex flex-col gap-1.5">
              {totals.map((header) => (
                <div key={header.id} className="flex items-start justify-between gap-3">
                  <dt className="max-w-[45%] shrink-0 text-xs font-normal text-slate-600">
                    {columnLabelOf(header.column) ?? header.column.id}
                  </dt>
                  <dd className={cn("m-0 min-w-0 break-words tabular-nums", alignClass(metaOf(header.column)?.align))}>
                    {flexRender(header.column.columnDef.footer, header.getContext())}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </li>
      )}
    </ul>
  )
}

/** Titre deduit du nom de fichier : tirets et soulignes deviennent des espaces. */
function titreDepuisNomFichier(nom: string): string {
  const texte = nom.replace(/[-_]+/g, " ").trim()
  return texte.charAt(0).toUpperCase() + texte.slice(1)
}

export function DataGrid<TData>({
  columns,
  data,
  storageKey,
  getRowId,
  loading = false,
  error = null,
  enableSearch = true,
  searchPlaceholder,
  facets = [],
  enableSelection = false,
  renderBulkActions,
  enableColumnVisibility = true,
  enableDensity = true,
  enableSorting = true,
  triInitial,
  enableResizing = true,
  enableFullscreen = true,
  enableExport = true,
  exportFileName = "export",
  exportTitle,
  exportSubtitle,
  afficherCompteur = true,
  totalLignes,
  aUneSuite = false,
  chargementSuite = false,
  chargerSuite,
  toolbarActions,
  helpTopic,
  onRowClick,
  getRowClassName,
  emptyState,
  renderFooter,
  renderExpandedRow,
  getSubRows,
  affichageMobile = "tableau",
  expanded: expandedPilote,
  onExpandedChange: onExpandedChangePilote,
  champsCumules,
  regroupementServeur = false,
  onRegroupementChange,
  className,
  maxHeight = "calc(100vh - 20rem)",
}: DataGridProps<TData>) {
  const t = useTranslations("common.dataGrid")
  const locale = useLocale()

  // Sans `triInitial`, l'ordre de depart est celui des donnees recues.
  const [sorting, setSorting] = useState<SortingState>(() => triInitial ?? [])
  // Derniere valeur de `triInitial` (les pages la passent souvent en litteral,
  // donc avec une identite neuve a chaque rendu) : lue au retrait du tri.
  const triInitialRef = useRef(triInitial)
  triInitialRef.current = triInitial
  const changerTri = useCallback((updater: Updater<SortingState>) => {
    setSorting((courant) => {
      const suivant = typeof updater === "function" ? updater(courant) : updater
      // Retirer le tri ramene au tri par defaut de la grille, pas a l'ordre brut.
      return suivant.length === 0 ? (triInitialRef.current ?? []) : suivant
    })
  }, [])

  // Tri en cours, relu par la fonction de tri ci-dessous (voir plus bas) pour
  // connaitre le sens de la colonne triee ; mis a jour a chaque rendu.
  const sortingRef = useRef(sorting)
  sortingRef.current = sorting

  // Tri par defaut des colonnes : texte sans accents ni casse, nombres et dates
  // par valeur, vides en dernier, dans la langue de l'interface.
  const sortingFns = useMemo<Record<string, SortingFn<TData>>>(
    () => ({
      libelle: (rowA, rowB, columnId) => {
        const a = rowA.getValue(columnId)
        const b = rowB.getValue(columnId)
        const resultat = trierCellules(a, b, locale)
        // TanStack inverse le resultat d'un tri decroissant, ce qui ferait
        // remonter les valeurs vides en tete : on le compense pour qu'elles
        // restent en dernier dans les deux sens.
        const descendant = sortingRef.current.find((entree) => entree.id === columnId)?.desc
        return descendant && celluleVide(a) !== celluleVide(b) ? -resultat : resultat
      },
    }),
    [locale]
  )
  // Les facettes qui portent une valeur par defaut s'appliquent des le premier
  // rendu ; le bouton « reinitialiser » les retire comme n'importe quel filtre.
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() =>
    facets
      .filter((facet) => facet.defaultValue !== undefined)
      .map((facet) => ({ id: facet.columnId, value: facet.defaultValue }))
  )
  const [globalFilter, setGlobalFilter] = useState("")
  const [rowSelection, setRowSelection] = useState({})
  const [nbRendues, setNbRendues] = useState(LOT_LIGNES)
  const zoneDefilanteRef = useRef<HTMLDivElement>(null)
  const sentinelleRef = useRef<HTMLDivElement>(null)
  const [expandedInterne, setExpandedInterne] = useState<ExpandedState>({})
  const expanded = expandedPilote ?? expandedInterne
  const [fullscreen, setFullscreen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const { preferences, update, hydrated } = useGridPreferences(storageKey, {
    columnVisibility: {},
    columnSizing: {},
    density: "normal",
  })

  // Sur telephone, les colonnes de priorite basse sont masquees par defaut. Ce
  // defaut n'est jamais ecrit dans le stockage : le choix explicite de
  // l'utilisateur (vrai ou faux) passe par-dessus et seul lui est memorise.
  const isMobile = useIsMobile()
  const vueCartes = isMobile && affichageMobile === "cartes"
  const columnVisibility = useMemo<VisibilityState>(() => {
    if (!isMobile) return preferences.columnVisibility
    const defauts: VisibilityState = {}
    columns.forEach((column) => {
      const id = columnIdOf(column)
      if (id && (column.meta as DataGridColumnMeta<TData> | undefined)?.priorite === "basse") {
        defauts[id] = false
      }
    })
    return { ...defauts, ...preferences.columnVisibility }
  }, [isMobile, columns, preferences.columnVisibility])

  // Regroupement facon pivot : une dimension decochee cumule les lignes. Les
  // grilles arborescentes sont deja des cumuls, elles n'en ont pas.
  const signatureChamps = champsCumules?.join("\u001f") ?? ""
  const regroupement = useMemo(
    () =>
      enableColumnVisibility && !getSubRows
        ? calculerRegroupement(columns, preferences.columnVisibility, signatureChamps ? signatureChamps.split("\u001f") : [])
        : null,
    [enableColumnVisibility, getSubRows, columns, preferences.columnVisibility, signatureChamps]
  )
  // Lu par le modele de lignes regroupees, que TanStack ne fabrique qu'une fois.
  const regroupementRef = useRef({ regroupement, fusionner: !regroupementServeur })
  regroupementRef.current = { regroupement, fusionner: !regroupementServeur }
  const getRegroupe = useMemo(() => getRegroupedRowModel<TData>(() => regroupementRef.current), [])

  // Masquees le temps du regroupement : les colonnes sans cumul possible, et
  // celles qui agissent sur une ligne precise (selection, detail, actions).
  const masqueesParRegroupement = useMemo(
    () =>
      new Set(
        regroupement
          ? [...regroupement.dimensionsMasquees, ...regroupement.nonCumulables, SELECTION_COLUMN_ID, EXPANDER_COLUMN_ID]
          : []
      ),
    [regroupement]
  )
  const visibiliteEffective = useMemo<VisibilityState>(() => {
    if (!regroupement) return columnVisibility
    const forcee: VisibilityState = { ...columnVisibility }
    masqueesParRegroupement.forEach((id) => {
      forcee[id] = false
    })
    return forcee
  }, [regroupement, columnVisibility, masqueesParRegroupement])

  // La page qui regroupe cote serveur recharge ses lignes quand les dimensions
  // affichees changent. Rien n'est annonce avant la lecture des preferences :
  // la page chargerait le detail pour rien avant le cumul memorise.
  const onRegroupementChangeRef = useRef(onRegroupementChange)
  onRegroupementChangeRef.current = onRegroupementChange
  const dimensionsAffichees = regroupement ? JSON.stringify(regroupement.dimensions) : null
  useEffect(() => {
    if (!hydrated) return
    onRegroupementChangeRef.current?.(dimensionsAffichees === null ? null : (JSON.parse(dimensionsAffichees) as string[]))
  }, [hydrated, dimensionsAffichees])

  /**
   * Colonnes effectives : la case a cocher est ajoutee ici plutot que dans chaque
   * page, et les colonnes de facette recoivent une egalite stricte (sans quoi le
   * filtre « actif » retiendrait aussi « inactif », qui contient le mot). Un
   * choix qui declare `matches` retient toutes les valeurs de sa liste.
   */
  const resolvedColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
    const prepared = columns.map((column) => {
      const id = columnIdOf(column)
      const facet = id ? facets.find((candidate) => candidate.columnId === id) : undefined
      if (facet) {
        const filtreFacette: FilterFn<TData> = (row, columnId, valeur) => {
          const choix = facet.options.find((option) => option.value === valeur)
          const attendues = choix?.matches ?? [String(valeur)]
          return attendues.includes(String(row.getValue(columnId) ?? ""))
        }
        return { ...column, filterFn: filtreFacette }
      }
      return column
    })

    // Colonne de depliement, ajoutee des qu'un detail est fourni.
    const withExpander = renderExpandedRow
      ? [
          {
            id: EXPANDER_COLUMN_ID,
            size: 44,
            minSize: 44,
            maxSize: 44,
            enableSorting: false,
            enableHiding: false,
            enableResizing: false,
            meta: { system: true, align: "center" } satisfies DataGridColumnMeta<TData>,
            header: () => null,
            cell: ({ row }) => (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  row.toggleExpanded()
                }}
                aria-expanded={row.getIsExpanded()}
                aria-label={row.getIsExpanded() ? t("collapseRow") : t("expandRow")}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-foreground"
              >
                {row.getIsExpanded() ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                )}
              </button>
            ),
          } satisfies ColumnDef<TData, unknown>,
          ...prepared,
        ]
      : prepared

    if (!enableSelection) return withExpander

    const selectionColumn: ColumnDef<TData, unknown> = {
      id: SELECTION_COLUMN_ID,
      size: 44,
      minSize: 44,
      maxSize: 44,
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
      meta: { system: true, align: "center" } satisfies DataGridColumnMeta<TData>,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
          aria-label={t("selectAllRows")}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(value === true)}
          onClick={(event) => event.stopPropagation()}
          aria-label={t("selectRow")}
        />
      ),
    }

    return [selectionColumn, ...withExpander]
  }, [columns, enableSelection, facets, renderExpandedRow, t])

  // Un tri sur une colonne masquee par le regroupement ordonnerait les cumuls
  // selon la premiere ligne de chaque groupe : on ne le garde pas.
  const triEffectif = useMemo(
    () => (regroupement ? sorting.filter((entree) => !masqueesParRegroupement.has(entree.id)) : sorting),
    [regroupement, sorting, masqueesParRegroupement]
  )

  const table = useReactTable({
    data,
    columns: resolvedColumns,
    state: {
      sorting: triEffectif,
      columnFilters,
      globalFilter,
      rowSelection,
      expanded,
      columnVisibility: visibiliteEffective,
      columnSizing: preferences.columnSizing,
    },
    getRowId,
    sortingFns,
    // Toute colonne sans `sortingFn` explicite trie par libelle (voir `trierCellules`).
    // `undefined` est traite par TanStack avant le sortingFn : `sortUndefined: "last"`
    // (valeur absolue, independante du sens) le garde en dernier en tri decroissant.
    defaultColumn: { sortingFn: "libelle", sortUndefined: "last" },
    initialState: { sorting: triInitial ?? [] },
    onSortingChange: changerTri,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onExpandedChange: onExpandedChangePilote ?? setExpandedInterne,
    onColumnVisibilityChange: (updater) =>
      update(
        "columnVisibility",
        typeof updater === "function"
          ? (updater(preferences.columnVisibility) as VisibilityState)
          : updater
      ),
    onColumnSizingChange: (updater) =>
      update(
        "columnSizing",
        typeof updater === "function" ? updater(preferences.columnSizing) : updater
      ),
    globalFilterFn: globalSearchFilter as FilterFn<TData>,
    enableSorting,
    enableColumnResizing: enableResizing,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getRegroupe,
    getSortedRowModel: getSortedRowModel(),
    ...(renderExpandedRow
      ? { getExpandedRowModel: getExpandedRowModel(), getRowCanExpand: () => true }
      : {}),
    // Arborescence : une ligne mere reste a l'ecran des qu'une de ses filles
    // correspond a la recherche, et les lignes depliees survivent a un nouveau
    // calcul des donnees (TanStack les refermerait a chaque changement).
    ...(getSubRows
      ? {
          getSubRows,
          getExpandedRowModel: getExpandedRowModel(),
          filterFromLeafRows: true,
          autoResetExpanded: false,
        }
      : {}),
  })

  const rows = table.getRowModel().rows

  // Derniere valeur de `chargerSuite` : les pages la passent souvent en fleche
  // litterale, et l'observateur ne doit pas etre recree a chaque rendu pour autant.
  const chargerSuiteRef = useRef(chargerSuite)
  chargerSuiteRef.current = chargerSuite
  // Nombre de lignes pour lequel le paquet suivant a deja ete demande : une seule
  // demande par paquet, meme si la sentinelle reste visible pendant le chargement.
  // Un echec ne relance donc rien de lui-meme, ce qui evite de boucler sur une
  // erreur serveur.
  const suiteDemandeeRef = useRef<number | null>(null)

  // Un nouveau tri, un nouveau filtre ou un rechargement ramene en haut de la
  // liste, comme le faisait le retour a la premiere page : rester au milieu
  // d'une liste reordonnee laisserait croire que les premieres lignes ont change.
  // Un paquet ajoute par `chargerSuite` ne passe pas par `loading` et laisse
  // donc la position de lecture en place.
  useEffect(() => {
    setNbRendues(LOT_LIGNES)
    suiteDemandeeRef.current = null
    zoneDefilanteRef.current?.scrollTo?.({ top: 0 })
  }, [triEffectif, columnFilters, globalFilter, loading])

  // La sentinelle couvre le bas de la liste : des qu'elle entre dans la partie
  // visible de la zone defilante, on dessine le lot suivant, puis on demande le
  // paquet suivant au serveur quand tout ce qui est charge est dessine.
  // L'observateur est recree a chaque etape : il signale alors aussitot une
  // sentinelle encore visible, ce qui remplit un grand ecran sans attendre.
  // Sans IntersectionObserver (tests, vieux navigateurs), tout est dessine.
  const resteADessiner = nbRendues < rows.length
  const suiteAttendue = aUneSuite && !chargementSuite && !loading && !error
  useEffect(() => {
    const sentinelle = sentinelleRef.current
    if (!sentinelle || (!resteADessiner && !suiteAttendue)) return
    if (typeof IntersectionObserver === "undefined") {
      if (resteADessiner) setNbRendues(Number.POSITIVE_INFINITY)
      return
    }
    const observateur = new IntersectionObserver((entrees) => {
      if (!entrees.some((entree) => entree.isIntersecting)) return
      if (resteADessiner) {
        setNbRendues((nb) => nb + LOT_LIGNES)
      } else if (suiteDemandeeRef.current !== rows.length) {
        suiteDemandeeRef.current = rows.length
        chargerSuiteRef.current?.()
      }
    })
    observateur.observe(sentinelle)
    return () => observateur.disconnect()
  }, [resteADessiner, suiteAttendue, nbRendues, rows.length])

  // Le plein ecran se quitte aussi a la touche Echap.
  useEffect(() => {
    if (!fullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [fullscreen])

  const handleExport = useCallback(
    async (format: "csv" | "excel") => {
      // Lignes filtrees ET triees : le fichier suit l'ordre affiche a l'ecran
      // (le modele filtre seul garde l'ordre brut des donnees).
      const rows = table.getSortedRowModel().rows
      if (rows.length === 0) {
        toast.error(t("exportEmpty"))
        return
      }

      // On exporte ce que l'utilisateur voit : colonnes visibles, lignes filtrees,
      // dans l'ordre de tri courant. Les colonnes techniques sont ecartees.
      const exportedColumns = table
        .getVisibleLeafColumns()
        .filter((column) => !(column.columnDef.meta as DataGridColumnMeta<TData> | undefined)?.system)

      const colonnes: Record<string, OptionsColonne> = {}
      exportedColumns.forEach((column) => {
        const meta = column.columnDef.meta as DataGridColumnMeta<TData> | undefined
        const options: OptionsColonne = {}
        if (meta?.exportFormat) options.format = meta.exportFormat
        if (meta?.exportSeuils !== undefined) options.seuils = meta.exportSeuils
        if (Object.keys(options).length > 0) colonnes[meta?.label ?? column.id] = options
      })

      const payload = rows.map((row) => {
        const record: Record<string, unknown> = {}
        exportedColumns.forEach((column) => {
          const meta = column.columnDef.meta as DataGridColumnMeta<TData> | undefined
          const header = meta?.label ?? column.id
          record[header] = meta?.exportValue
            ? meta.exportValue(row.original)
            : row.getValue(column.id)
        })
        return record
      })

      setExporting(true)
      try {
        const stamp = new Date().toISOString().slice(0, 10)
        if (format === "csv") {
          exportRowsToCsv(payload, `${exportFileName}-${stamp}.csv`)
        } else {
          await exportRowsToExcel(payload, `${exportFileName}-${stamp}.xlsx`, {
            worksheetName: exportFileName.slice(0, 31),
            titre: exportTitle ?? titreDepuisNomFichier(exportFileName),
            sousTitre: exportSubtitle,
            colonnes,
            libelles: {
              // Date et heure formatees a la main : meme rendu dans toutes les langues.
              exporteLe: (date) => {
                const deux = (n: number) => String(n).padStart(2, "0")
                return t("exportedOn", {
                  date: `${deux(date.getDate())}/${deux(date.getMonth() + 1)}/${date.getFullYear()}`,
                  time: `${deux(date.getHours())}:${deux(date.getMinutes())}`,
                })
              },
              pagination: (page, total) => t("exportPagination", { page, total }),
            },
          })
        }
        toast.success(t("exportDone", { count: payload.length }))
      } catch {
        toast.error(t("exportFailed"))
      } finally {
        setExporting(false)
      }
    },
    [table, exportFileName, exportTitle, exportSubtitle, t]
  )

  // Une ligne regroupee n'est aucune ligne en particulier : pas de clic vers une
  // fiche, pas de couleur d'etat, pas de detail deplie.
  const clicLigne = regroupement ? undefined : onRowClick
  const classeLigne = regroupement ? undefined : getRowClassName
  const detailLigne = regroupement ? undefined : renderExpandedRow
  const libelleColonne = (id: string) => {
    const column = table.getColumn(id)
    return (column && columnLabelOf(column)) ?? id
  }
  const listeLibelles = (ids: string[], type: "conjunction" | "disjunction") =>
    new Intl.ListFormat(locale, { style: "long", type }).format(ids.map(libelleColonne))
  const revenirAuDetail = () => {
    if (!regroupement) return
    const visibilite = { ...preferences.columnVisibility }
    regroupement.dimensionsMasquees.forEach((id) => {
      visibilite[id] = true
    })
    update("columnVisibility", visibilite)
  }

  const lignesRendues = resteADessiner ? rows.slice(0, nbRendues) : rows
  // Lignes de premier niveau (groupes cumules, racines d'une arborescence) : ce
  // que l'utilisateur compte en lisant le tableau, sans les lignes depliees.
  const nbLignes = table.getSortedRowModel().rows.length
  const selectedRows = table.getSelectedRowModel().rows
  const hasFooterRow = table.getAllLeafColumns().some((column) => column.columnDef.footer)
  const showToolbar =
    enableSearch ||
    facets.length > 0 ||
    enableColumnVisibility ||
    enableDensity ||
    enableExport ||
    enableFullscreen ||
    Boolean(toolbarActions) ||
    Boolean(helpTopic)
  const hasFilters = columnFilters.length > 0 || globalFilter.length > 0
  const densityClass = DENSITY_CLASSES[preferences.density]
  const resetFilters = () => {
    table.resetColumnFilters()
    table.setGlobalFilter("")
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white shadow-sm",
        fullscreen && "fixed inset-0 z-50 rounded-none border-0",
        className
      )}
    >
      {/*
        La barre d'outils disparait quand elle n'a rien a proposer : integree a
        un petit encart de tableau de bord, une bande vide mangerait l'espace
        utile sans rien apporter.
      */}
      {showToolbar && (
      <DataGridToolbar
        table={table}
        enableSearch={enableSearch}
        searchPlaceholder={searchPlaceholder}
        facets={facets}
        enableColumnVisibility={enableColumnVisibility}
        enableDensity={enableDensity}
        density={preferences.density}
        onDensityChange={(density) => update("density", density)}
        enableExport={enableExport}
        onExport={handleExport}
        exporting={exporting}
        enableFullscreen={enableFullscreen}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen((value) => !value)}
        actions={toolbarActions}
        helpTopic={helpTopic}
        nonCumulables={regroupement?.nonCumulables}
      />
      )}

      {regroupement && (
        <div
          role="status"
          data-testid="bandeau-regroupement"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-primary/5 px-3 py-2 text-xs sm:px-4"
        >
          <Layers className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="font-medium text-foreground">
            {regroupement.dimensions.length > 0
              ? t("regroupePar", { dimensions: listeLibelles(regroupement.dimensions, "conjunction") })
              : t("regroupeTout")}
          </span>
          {!regroupementServeur && !loading && table.getPreGroupedRowModel().rows.length > 0 && (
            <span className="text-muted-foreground">
              {t("lignesCumulees", {
                lignes: table.getPreGroupedRowModel().rows.length,
                groupes: table.getGroupedRowModel().rows.length,
              })}
            </span>
          )}
          {regroupement.nonCumulables.some((id) => columnVisibility[id] !== false) && (
            <span className="text-muted-foreground">
              {t("nonCumulablesMasquees", {
                colonnes: listeLibelles(
                  regroupement.nonCumulables.filter((id) => columnVisibility[id] !== false),
                  "conjunction"
                ),
              })}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto h-11 gap-1 px-2 text-xs text-primary md:h-7"
            onClick={revenirAuDetail}
          >
            {t("voirDetail")}
          </Button>
        </div>
      )}

      {enableSelection && !regroupement && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b bg-primary/5 px-3 py-2 sm:px-4">
          <span className="text-sm font-medium">
            {t("selectedCount", { count: selectedRows.length })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-muted-foreground"
            onClick={() => setRowSelection({})}
          >
            <X className="h-3.5 w-3.5" />
            {t("clearSelection")}
          </Button>
          <div className="ms-auto flex items-center gap-2">
            {renderBulkActions?.(selectedRows, table)}
          </div>
        </div>
      )}

      {vueCartes && enableSorting && !loading && !error && rows.length > 0 && (
        <GridSortMenu table={table} triInitial={triInitial} />
      )}

      <div
        ref={zoneDefilanteRef}
        data-testid="zone-defilante"
        className={cn(
          "scrollbar-thin relative min-w-0 flex-1 overflow-auto",
          !fullscreen &&
            "max-h-[max(var(--grille-hauteur-max),var(--grille-plancher-mobile))] md:max-h-[var(--grille-hauteur-max)]"
        )}
        style={
          {
            "--grille-hauteur-max": maxHeight,
            "--grille-plancher-mobile": PLANCHER_MOBILE,
          } as React.CSSProperties
        }
      >
        {vueCartes ? (
          loading ? (
            <div className="px-4 py-16">
              <GridLoadingState />
            </div>
          ) : error ? (
            <div className="px-4 py-16">
              <GridErrorState error={error} />
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-16">
              <GridEmptyState
                hasFilters={hasFilters}
                emptyState={emptyState}
                onResetFilters={resetFilters}
              />
            </div>
          ) : (
            <GridCards
              table={table}
              rows={lignesRendues}
              onRowClick={clicLigne}
              getRowClassName={classeLigne}
              renderExpandedRow={detailLigne}
              showTotals={hasFooterRow}
            />
          )
        ) : (
          <table
            className="w-full border-separate border-spacing-0 text-sm"
            style={enableResizing ? { minWidth: Math.max(table.getTotalSize(), 0) || undefined } : undefined}
          >
            <thead className="sticky top-0 z-20">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta as DataGridColumnMeta<TData> | undefined
                    const sorted = header.column.getIsSorted()
                    const canSort = header.column.getCanSort()

                    return (
                      <th
                        key={header.id}
                        colSpan={header.colSpan}
                        scope="col"
                        style={cellStyle(meta, enableResizing ? header.getSize() : undefined)}
                        className={cn(
                          "relative border-b bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-700",
                          ALIGN_CLASSES[meta?.align ?? "start"],
                          meta?.hideOnMobile && "hidden md:table-cell",
                          meta?.sticky && "sticky z-10"
                        )}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            // Maj + clic ajoute la colonne au tri en cours plutot
                            // que de remplacer le tri : tri multi-colonnes.
                            onClick={header.column.getToggleSortingHandler()}
                            title={
                              sorted === "asc"
                                ? t("sortDesc")
                                : sorted === "desc"
                                  ? t("sortClear")
                                  : t("sortAsc")
                            }
                            className={cn(
                              "group inline-flex max-w-full items-center gap-1.5 rounded transition-colors hover:text-foreground [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
                              meta?.align === "center" && "justify-center",
                              meta?.align === "end" && "justify-end"
                            )}
                          >
                            <span className="truncate">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                            {sorted === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5 shrink-0 text-primary" />
                            ) : sorted === "desc" ? (
                              <ArrowDown className="h-3.5 w-3.5 shrink-0 text-primary" />
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-400" />
                            )}
                            {sorting.length > 1 && sorted && (
                              <span className="shrink-0 text-[10px] font-bold text-primary">
                                {sorting.findIndex((entry) => entry.id === header.column.id) + 1}
                              </span>
                            )}
                          </button>
                        ) : (
                          <span className="truncate">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                        )}

                        {enableResizing && header.column.getCanResize() && (
                          <span
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            onClick={(event) => event.stopPropagation()}
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={t("resizeColumn")}
                            className={cn(
                              "absolute end-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none",
                              "hover:bg-primary/40",
                              header.column.getIsResizing() && "bg-primary"
                            )}
                          />
                        )}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length} className="px-4 py-16">
                    <GridLoadingState />
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length} className="px-4 py-16">
                    <GridErrorState error={error} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length} className="px-4 py-16">
                    <GridEmptyState
                      hasFilters={hasFilters}
                      emptyState={emptyState}
                      onResetFilters={resetFilters}
                    />
                  </td>
                </tr>
              ) : (
                lignesRendues.map((row) => (
                  <React.Fragment key={row.id}>
                  <tr
                    onClick={clicLigne ? () => clicLigne(row.original) : undefined}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className={cn(
                      "group transition-colors hover:bg-slate-50/80",
                      row.getIsSelected() && "bg-primary/5",
                      clicLigne && "cursor-pointer",
                      classeLigne?.(row.original)
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as DataGridColumnMeta<TData> | undefined
                      return (
                        <td
                          key={cell.id}
                          style={cellStyle(meta, enableResizing ? cell.column.getSize() : undefined)}
                          className={cn(
                            "border-b border-slate-100 align-middle",
                            densityClass,
                            ALIGN_CLASSES[meta?.align ?? "start"],
                            meta?.hideOnMobile && "hidden md:table-cell",
                            // Une colonne collee doit rester opaque : sans fond, les
                            // cellules defilant dessous resteraient visibles au travers.
                            meta?.sticky && "sticky z-[1] bg-white group-hover:bg-slate-50",
                            meta?.cellClassName
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      )
                    })}
                  </tr>

                  {/* Detail deplie : une ligne pleine largeur sous la ligne mere. */}
                  {detailLigne && row.getIsExpanded() && (
                    <tr>
                      <td
                        colSpan={row.getVisibleCells().length}
                        className="border-b border-slate-100 bg-slate-50/70 px-3 py-3"
                      >
                        {detailLigne(row.original)}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))
              )}
            </tbody>

            {/*
              Ligne de totaux : rendue des qu'une colonne definit un `footer`. Elle
              reste collee au bas de la zone defilante, sinon elle disparaitrait
              des que la liste depasse la hauteur visible — or c'est la ligne que
              l'on vient lire en premier sur un tableau de chiffres.
            */}
            {hasFooterRow && rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-20">
                {table.getFooterGroups().map((footerGroup) => (
                  <tr key={footerGroup.id}>
                    {footerGroup.headers.map((header) => {
                      const meta = header.column.columnDef.meta as
                        | DataGridColumnMeta<TData>
                        | undefined
                      return (
                        <td
                          key={header.id}
                          colSpan={header.colSpan}
                          style={cellStyle(meta, enableResizing ? header.getSize() : undefined)}
                          className={cn(
                            "border-t bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-800",
                            ALIGN_CLASSES[meta?.align ?? "start"],
                            meta?.hideOnMobile && "hidden md:table-cell",
                            meta?.sticky && "sticky z-10 bg-slate-100"
                          )}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.footer, header.getContext())}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        )}

        {chargementSuite && (
          <div
            role="status"
            className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
            {t("chargementSuite")}
          </div>
        )}

        {/*
          Sentinelle invisible posee sur le bas de la liste (marge negative) : elle
          entre dans la partie visible un peu avant la derniere ligne, ce qui laisse
          le temps de dessiner ou de charger la suite avant que l'on bute sur la fin.
        */}
        {!loading && !error && (resteADessiner || suiteAttendue) && (
          <div
            ref={sentinelleRef}
            aria-hidden="true"
            data-testid="sentinelle-suite"
            className="pointer-events-none -mt-[40rem] h-[40rem]"
          />
        )}
      </div>

      {renderFooter && <div className="border-t bg-slate-50/60 px-3 py-2 sm:px-4">{renderFooter(table)}</div>}

      {afficherCompteur && !loading && !error && rows.length > 0 && (
        <div
          data-testid="compteur-lignes"
          className="border-t bg-white px-3 py-2 text-sm tabular-nums text-muted-foreground sm:px-4"
        >
          {totalLignes !== undefined && totalLignes > nbLignes
            ? t("lignesChargees", { chargees: nbLignes, total: totalLignes })
            : t("nbLignes", { total: totalLignes ?? nbLignes })}
        </div>
      )}
    </div>
  )
}
