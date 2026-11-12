/**
 * Tableau simple.
 *
 * Pour une liste, utiliser `components/ui/data-grid` : recherche, tri, filtres,
 * colonnes et export y sont deja assembles. Ce composant reste pour les petits
 * tableaux imbriques — une etape d'assistant, un recapitulatif d'import — ou une
 * barre d'outils n'aurait pas de sens. Son habillage suit celui de la grille
 * pour que les deux ne jurent pas l'un a cote de l'autre.
 */

"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

/** Tolerance (px) pour les arrondis de scrollLeft sur ecrans a densite fractionnaire. */
const TOLERANCE_PX = 1

/**
 * Premiere cellule de chaque ligne figee au bord de depart (start-0, donc a droite en RTL).
 * Fond opaque pour masquer le defilement dessous, fine bordure de separation.
 * Ecrit en selecteurs d'enfant sur le <table> : les autres sous-composants restent inchanges.
 */
const CLASSES_PREMIERE_COLONNE_COLLANTE = [
  "[&_tr>*:first-child]:sticky [&_tr>*:first-child]:start-0 [&_tr>*:first-child]:z-[1]",
  "[&_tr>*:first-child]:border-e [&_tr>*:first-child]:border-border/70",
  "[&_tbody_tr>*:first-child]:bg-card [&_tfoot_tr>*:first-child]:bg-card",
  "[&_thead_tr>*:first-child]:bg-secondary",
].join(" ")

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** Fige la premiere colonne pendant le defilement horizontal (utile sur mobile). */
  premiereColonneCollante?: boolean
  /** Classes ajoutees au conteneur defilant (et non au <table>). */
  conteneurClassName?: string
  /** Nom accessible de la zone defilante (role « region »). */
  libelle?: string
  /** Petite ligne d'aide sous le tableau, mobile uniquement, quand le contenu depasse. */
  indicationDefilement?: boolean
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  (
    {
      className,
      premiereColonneCollante = false,
      conteneurClassName,
      libelle,
      indicationDefilement = false,
      ...props
    },
    ref
  ) => {
    const t = useTranslations("common.visibilite")
    const zoneRef = React.useRef<HTMLDivElement>(null)
    const [debutCache, setDebutCache] = React.useState(false)
    const [finCachee, setFinCachee] = React.useState(false)

    const mesurer = React.useCallback(() => {
      const el = zoneRef.current
      if (!el) return
      // En RTL scrollLeft est negatif ou positif selon le navigateur : valeur absolue,
      // le « debut » est toujours le cote start.
      const decalage = Math.abs(el.scrollLeft)
      const max = el.scrollWidth - el.clientWidth
      setDebutCache(max > TOLERANCE_PX && decalage > TOLERANCE_PX)
      setFinCachee(max > TOLERANCE_PX && decalage < max - TOLERANCE_PX)
    }, [])

    React.useEffect(() => {
      const el = zoneRef.current
      if (!el) return
      mesurer()
      if (typeof ResizeObserver === "undefined") return
      const observateur = new ResizeObserver(mesurer)
      observateur.observe(el)
      const tableau = el.firstElementChild
      if (tableau) observateur.observe(tableau)
      return () => observateur.disconnect()
    }, [mesurer])

    const deborde = debutCache || finCachee

    return (
      <div className="w-full">
        <div className="relative w-full">
          <div
            ref={zoneRef}
            role={libelle ? "region" : undefined}
            aria-label={libelle}
            tabIndex={deborde ? 0 : undefined}
            onScroll={mesurer}
            className={cn(
              "scrollbar-thin relative w-full overflow-auto rounded-lg border bg-card",
              conteneurClassName
            )}
          >
            <table
              ref={ref}
              className={cn(
                "w-full caption-bottom text-[13px] sm:text-sm",
                premiereColonneCollante && CLASSES_PREMIERE_COLONNE_COLLANTE,
                className
              )}
              {...props}
            />
          </div>
          {debutCache && (
            <div
              aria-hidden="true"
              data-degrade="debut"
              className="pointer-events-none absolute inset-y-0 start-0 w-6 rounded-s-lg bg-gradient-to-r rtl:bg-gradient-to-l from-card to-transparent"
            />
          )}
          {finCachee && (
            <div
              aria-hidden="true"
              data-degrade="fin"
              className="pointer-events-none absolute inset-y-0 end-0 w-6 rounded-e-lg bg-gradient-to-l rtl:bg-gradient-to-r from-card to-transparent"
            />
          )}
        </div>
        {indicationDefilement && deborde && (
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground md:hidden">
            {t("glisserCote")}
          </p>
        )}
      </div>
    )
  }
)
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("sticky top-0 z-10 bg-secondary [&_tr]:border-b [&_tr]:border-border", className)}
    {...props}
  />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-border/70 transition-colors hover:bg-accent/60 data-[state=selected]:bg-primary/5",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 sm:px-3 text-start align-middle text-xs font-semibold text-muted-foreground [&:has([role=checkbox])]:pe-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("px-2 py-2 sm:px-3 sm:py-2.5 align-middle [&:has([role=checkbox])]:pe-0", className)}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}



