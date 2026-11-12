"use client"

/**
 * Barre d'outils de la grille : recherche, filtres, reglages d'affichage, export.
 *
 * Tous les controles agissent sur l'instance TanStack Table passee en `table` :
 * la barre ne detient aucun etat de donnees, seulement le texte en cours de
 * frappe, qu'elle repercute apres une courte pause pour ne pas refiltrer a
 * chaque touche.
 */

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import type { Table } from "@tanstack/react-table"
import {
  Check,
  ChevronDown,
  Columns3,
  Download,
  FileSpreadsheet,
  FileText,
  Maximize2,
  Minimize2,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DataGridColumnMeta, DataGridFacet, GridDensity } from "./types"

/** Valeur du choix « tous » : Radix Select refuse la chaine vide. */
export const FACET_ALL = "__all__"

interface DataGridToolbarProps<TData> {
  table: Table<TData>
  enableSearch: boolean
  searchPlaceholder?: string
  facets: DataGridFacet[]
  enableColumnVisibility: boolean
  enableDensity: boolean
  density: GridDensity
  onDensityChange: (density: GridDensity) => void
  enableExport: boolean
  onExport: (format: "csv" | "excel") => void
  exporting: boolean
  enableFullscreen: boolean
  fullscreen: boolean
  onToggleFullscreen: () => void
  actions?: React.ReactNode
  helpTopic?: string
  /** Colonnes masquees par le regroupement en cours : grisees dans le menu « Colonnes ». */
  nonCumulables?: string[]
}

export function DataGridToolbar<TData>({
  table,
  enableSearch,
  searchPlaceholder,
  facets,
  enableColumnVisibility,
  enableDensity,
  density,
  onDensityChange,
  enableExport,
  onExport,
  exporting,
  enableFullscreen,
  fullscreen,
  onToggleFullscreen,
  actions,
  helpTopic,
  nonCumulables,
}: DataGridToolbarProps<TData>) {
  const t = useTranslations("common.dataGrid")
  const locale = useLocale()
  const tv = useTranslations("common.visibilite")
  const [filtresOuverts, setFiltresOuverts] = useState(false)
  const globalFilter = (table.getState().globalFilter as string) ?? ""
  const [draft, setDraft] = useState(globalFilter)

  // Le champ est pilote localement pour rester fluide ; la grille n'est refiltree
  // qu'apres 250 ms sans frappe.
  useEffect(() => {
    if (draft === globalFilter) return
    const timer = setTimeout(() => table.setGlobalFilter(draft), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  // Reinitialisation declenchee ailleurs (bouton « effacer ») : on resynchronise.
  useEffect(() => {
    if (globalFilter === "") setDraft((current) => (current === "" ? current : ""))
  }, [globalFilter])

  const columnFilters = table.getState().columnFilters
  const activeFilters = columnFilters.length + (globalFilter ? 1 : 0)

  const hideableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide() && !(column.columnDef.meta as DataGridColumnMeta<TData> | undefined)?.system)

  const hiddenCount = hideableColumns.filter((column) => !column.getIsVisible()).length
  // Colonnes de regroupement : les decocher cumule les lignes, comme dans un pivot.
  const dimensions = hideableColumns.filter(
    (column) => (column.columnDef.meta as DataGridColumnMeta<TData> | undefined)?.dimension
  )
  const libelleDe = (column: (typeof hideableColumns)[number]) =>
    (column.columnDef.meta as DataGridColumnMeta<TData> | undefined)?.label ?? column.id
  // Sous md, les facettes se replient derriere le bouton « Filtres ». Sans facette,
  // le bloc ne contient que « Reinitialiser » : il reste affiche.
  const facettesReplies = facets.length > 0 && !filtresOuverts

  const densityOptions: { value: GridDensity; label: string }[] = [
    { value: "compact", label: t("densityCompact") },
    { value: "normal", label: t("densityNormal") },
    { value: "comfortable", label: t("densityComfortable") },
  ]

  return (
    <div className="flex flex-col gap-3 border-b bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {enableSearch && (
          <div className="relative w-full min-w-[12rem] sm:max-w-sm md:w-auto md:flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={searchPlaceholder ?? t("search")}
              aria-label={searchPlaceholder ?? t("search")}
              className="h-11 ps-9 pe-9 text-base md:h-9 md:text-sm"
            />
            {draft && (
              <button
                type="button"
                onClick={() => {
                  setDraft("")
                  table.setGlobalFilter("")
                }}
                aria-label={t("clearSearch")}
                className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-slate-100 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {facets.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-11 gap-1.5 md:hidden"
            onClick={() => setFiltresOuverts((value) => !value)}
            aria-expanded={filtresOuverts}
            title={filtresOuverts ? tv("masquerFiltres") : tv("afficherFiltres")}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            {tv("filtres")}
            {columnFilters.length > 0 && <Badge variant="secondary">{columnFilters.length}</Badge>}
          </Button>
        )}

        {/* Sous md : replie derriere « Filtres », en dessous des actions. Des md : transparent pour la mise en page. */}
        <div
          className={cn(
            "order-last w-full flex-wrap items-center gap-2 md:contents",
            facettesReplies ? "hidden" : "flex"
          )}
        >
          {facets.map((facet) => {
            const column = table.getColumn(facet.columnId)
            if (!column) return null
            const value = (column.getFilterValue() as string | undefined) ?? FACET_ALL
            const selected = facet.options.find((option) => option.value === value)

            return (
              <DropdownMenu key={facet.columnId}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("h-11 gap-1.5 md:h-9", value !== FACET_ALL && "border-primary/50 bg-primary/5")}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="max-w-[10rem] truncate">
                      {selected ? selected.label : facet.label}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
                  <DropdownMenuLabel>{facet.label}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={() => column.setFilterValue(undefined)}>
                    <span className="flex-1">{t("all")}</span>
                    {value === FACET_ALL && <Check className="h-4 w-4 text-primary" />}
                  </DropdownMenuItem>
                  {facet.options.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      className="min-h-11 md:min-h-0"
                      onSelect={() => column.setFilterValue(option.value)}
                    >
                      <span className="flex-1 truncate">{option.label}</span>
                      {value === option.value && <Check className="h-4 w-4 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )
          })}

          {activeFilters > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 gap-1.5 text-muted-foreground md:h-9"
              onClick={() => {
                table.resetColumnFilters()
                table.setGlobalFilter("")
                setDraft("")
              }}
            >
              <X className="h-3.5 w-3.5" />
              {t("resetFilters")}
              <Badge variant="secondary" className="ms-1">
                {activeFilters}
              </Badge>
            </Button>
          )}
        </div>

        {/* Ordre fixe en fin de barre : Densite, Exporter, puis Agrandir tout a droite. */}
        <div className="ms-auto flex flex-wrap items-center justify-end gap-2 md:flex-nowrap">
          {enableColumnVisibility && hideableColumns.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-11 gap-1.5 md:h-9" title={t("columns")}>
                  <Columns3 className="h-3.5 w-3.5" />
                  <span className="md:hidden lg:inline">{t("columns")}</span>
                  {hiddenCount > 0 && (
                    <Badge variant="secondary" className="md:hidden">
                      {tv("masques", { count: hiddenCount })}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-96 w-60 overflow-y-auto">
                <DropdownMenuLabel>{t("columnsHint")}</DropdownMenuLabel>
                {dimensions.length > 0 && (
                  <p className="px-2 pb-1.5 text-xs font-normal text-muted-foreground">
                    {t("aideRegroupement", {
                      dimensions: new Intl.ListFormat(locale, { style: "long", type: "disjunction" }).format(
                        dimensions.map(libelleDe)
                      ),
                    })}
                  </p>
                )}
                <DropdownMenuSeparator />
                {hideableColumns.map((column) => {
                  const meta = column.columnDef.meta as DataGridColumnMeta<TData> | undefined
                  // Masquee par le regroupement : la cocher n'aurait aucun effet visible.
                  const bloquee = nonCumulables?.includes(column.id) ?? false
                  return (
                    <DropdownMenuItem
                      key={column.id}
                      className="min-h-11 md:min-h-0"
                      disabled={bloquee}
                      // `onSelect` ferme le menu par defaut : on l'empeche pour
                      // permettre de cocher plusieurs colonnes d'affilee.
                      onSelect={(event) => {
                        event.preventDefault()
                        column.toggleVisibility()
                      }}
                    >
                      <span className="flex-1 truncate">{libelleDe(column)}</span>
                      {bloquee && (
                        <span className="ms-2 shrink-0 text-[10px] text-muted-foreground">{t("nonCumulable")}</span>
                      )}
                      {meta?.priorite === "basse" && (
                        <span className="ms-2 shrink-0 text-[10px] text-muted-foreground md:hidden">
                          {tv("colonnesSecondaires")}
                        </span>
                      )}
                      {column.getIsVisible() && <Check className="h-4 w-4 text-primary" />}
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={() => table.toggleAllColumnsVisible(true)}>
                  {t("showAllColumns")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {actions}

          {enableDensity && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hidden h-9 gap-1.5 md:inline-flex" title={t("density")}>
                  <Rows3 className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">{t("density")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>{t("density")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {densityOptions.map((option) => (
                  <DropdownMenuItem key={option.value} onSelect={() => onDensityChange(option.value)}>
                    <span className="flex-1">{option.label}</span>
                    {density === option.value && <Check className="h-4 w-4 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {enableExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 min-w-11 gap-1.5 md:h-9 md:min-w-0"
                  disabled={exporting}
                  title={t("export")}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">{t("export")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={() => onExport("csv")}>
                  <FileText className="me-2 h-4 w-4 text-muted-foreground" />
                  {t("exportCsv")}
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={() => onExport("excel")}>
                  <FileSpreadsheet className="me-2 h-4 w-4 text-muted-foreground" />
                  {t("exportExcel")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {enableFullscreen && (
            <Button
              variant="outline"
              size="sm"
              className="hidden h-9 w-9 p-0 lg:inline-flex"
              onClick={onToggleFullscreen}
              title={fullscreen ? t("exitFullscreen") : t("fullscreen")}
              aria-label={fullscreen ? t("exitFullscreen") : t("fullscreen")}
            >
              {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

