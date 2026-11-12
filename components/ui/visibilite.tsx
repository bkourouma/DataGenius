"use client"

/**
 * Menu « afficher / masquer » partage : colonnes d'un tableau, lignes d'un
 * rapport ou tout autre ensemble d'elements. Meme comportement que le choix de
 * colonnes de la synthese par pays, avec des cibles tactiles de 44 px sur petit
 * ecran, une recherche au-dela d'un certain nombre d'elements et des groupes.
 *
 * Le composant ne stocke rien : il recoit la liste des elements masques et
 * renvoie la nouvelle liste complete (voir hooks/use-visibilite.ts).
 */

import * as React from "react"
import { useTranslations } from "next-intl"
import { Columns3, Rows3, SlidersHorizontal } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface ElementVisibilite {
  id: string
  libelle: string
  groupe?: string
  desactive?: boolean
}

export interface MenuVisibiliteProps {
  /** Tous les elements possibles, dans l'ordre d'affichage. */
  elements: ElementVisibilite[]
  masques: readonly string[]
  /** Recoit la nouvelle liste complete des elements masques. */
  onChange: (masques: string[]) => void
  onReinitialiser?: () => void
  masquesParDefaut?: readonly string[]
  type?: "colonnes" | "lignes" | "elements"
  /** Remplace le libelle du bouton. */
  libelle?: string
  minVisibles?: number
  seuilRecherche?: number
  align?: "start" | "center" | "end"
  className?: string
}

/** Garde les elements non masques. */
export function filtrerVisibles<T extends { id: string }>(
  elements: T[],
  masques: readonly string[]
): T[] {
  if (masques.length === 0) return elements
  const cache = new Set(masques)
  return elements.filter((element) => !cache.has(element.id))
}

function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

function memeContenu(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const ensemble = new Set(a)
  return b.every((id) => ensemble.has(id))
}

const ICONES = { colonnes: Columns3, lignes: Rows3, elements: SlidersHorizontal } as const

function Case({
  coche,
  onChange,
  disabled,
  children,
}: {
  coche: boolean
  onChange: (coche: boolean) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 md:min-h-8">
      <Checkbox
        checked={coche}
        onCheckedChange={(etat) => onChange(etat === true)}
        disabled={disabled}
      />
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </label>
  )
}

export function MenuVisibilite({
  elements,
  masques,
  onChange,
  onReinitialiser,
  masquesParDefaut,
  type = "colonnes",
  libelle,
  minVisibles = 0,
  seuilRecherche = 12,
  align = "end",
  className,
}: MenuVisibiliteProps) {
  const t = useTranslations("common.visibilite")
  const [recherche, setRecherche] = React.useState("")

  const Icone = ICONES[type]
  const nomBouton = libelle ?? t(type)
  const titre =
    type === "colonnes" ? t("titreColonnes") : type === "lignes" ? t("titreLignes") : t("titreElements")

  const defauts = masquesParDefaut ?? []
  const ids = React.useMemo(() => new Set(elements.map((e) => e.id)), [elements])
  const nbMasques = masques.filter((id) => ids.has(id)).length
  const nbAffiches = elements.length - nbMasques
  const estParDefaut = memeContenu(masques, defauts)

  const avecRecherche = elements.length > seuilRecherche
  const terme = avecRecherche ? normaliser(recherche) : ""
  const listes = terme
    ? elements.filter((e) => normaliser(e.libelle).includes(terme))
    : elements

  // Groupes dans l'ordre d'apparition ; les elements sans groupe restent a part.
  const sections = (() => {
    const resultat: { groupe: string | null; items: ElementVisibilite[] }[] = []
    for (const element of listes) {
      const groupe = element.groupe ?? null
      let section = resultat.find((s) => s.groupe === groupe)
      if (!section) {
        section = { groupe, items: [] }
        resultat.push(section)
      }
      section.items.push(element)
    }
    return resultat
  })()

  const basculer = (id: string, coche: boolean) =>
    onChange(coche ? masques.filter((x) => x !== id) : Array.from(new Set([...masques, id])))

  const reinitialiser = () => (onReinitialiser ? onReinitialiser() : onChange([...defauts]))

  const compteur = t("compteur", { affiches: nbAffiches, total: elements.length })

  return (
    <Popover onOpenChange={(ouvert) => !ouvert && setRecherche("")}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-11 gap-1.5 md:h-9", className)}
          aria-label={t("libelleBouton", { nom: nomBouton })}
          title={titre}
        >
          <Icone className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{nomBouton}</span>
          {nbMasques > 0 && (
            <Badge variant="secondary" className="ms-0.5 px-1.5 tabular-nums">
              {t("masques", { count: nbMasques })}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        collisionPadding={16}
        className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-3"
      >
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{titre}</p>
            <p className="text-xs tabular-nums text-muted-foreground" role="status" aria-live="polite">
              {compteur}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">{t("aide")}</p>
        </div>

        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-11 px-2 text-xs md:h-8"
            disabled={nbMasques === 0}
            onClick={() => onChange([])}
          >
            {t("afficherTout")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 px-2 text-xs md:h-8"
            disabled={estParDefaut}
            onClick={reinitialiser}
          >
            {t("reinitialiser")}
          </Button>
        </div>

        {avecRecherche && (
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder={t("rechercher")}
            aria-label={t("rechercher")}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
          />
        )}

        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {listes.length === 0 && (
            <p className="px-1.5 py-2 text-sm text-muted-foreground">{t("aucunResultat")}</p>
          )}
          {sections.map((section) => {
            const cases = section.items.map((element) => {
              const coche = !masques.includes(element.id)
              return (
                <Case
                  key={element.id}
                  coche={coche}
                  // Il reste au moins minVisibles elements affiches.
                  disabled={element.desactive || (coche && nbAffiches <= minVisibles)}
                  onChange={(etat) => basculer(element.id, etat)}
                >
                  {element.libelle}
                </Case>
              )
            })
            return section.groupe === null ? (
              <div key="__sans-groupe" className="space-y-0.5">
                {cases}
              </div>
            ) : (
              <fieldset key={section.groupe} className="space-y-0.5">
                <legend className="mb-1 text-xs font-medium text-muted-foreground">
                  {section.groupe}
                </legend>
                {cases}
              </fieldset>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
