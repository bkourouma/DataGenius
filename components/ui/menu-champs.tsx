"use client"

/**
 * Menu « Champs affichés » generique pour les pivots.
 *
 * Un champ correspond a une dimension du pivot (Pays, Grossiste, Produit...).
 * Decocher un champ masque d'un coup tous ses elements : le detail disparait et
 * il ne reste que le cumul. Recocher le champ les affiche tous. Les totaux ne
 * changent jamais. La case d'un champ est a trois etats :
 *   - coche      : tous les elements du champ sont affiches ;
 *   - decoche    : tous les elements sont masques ;
 *   - indetermine : une partie seulement est masquee (choix fin fait ailleurs).
 *
 * Le composant ne stocke rien : le pivot garde la liste de ses elements masques
 * et traduit chaque clic en masquage ou affichage de tous les elements du champ.
 *
 * Exemple de branchement :
 *
 *   const champs: ChampMenu[] = [
 *     { cle: "pays", libelle: t("pays"), total: pays.length,
 *       masques: pays.filter((p) => paysMasques.has(p)).length },
 *     { cle: "grossiste", libelle: t("grossiste"), total: grossistes.length,
 *       masques: grossistes.filter((g) => grossistesMasques.has(g)).length },
 *   ]
 *
 *   <MenuChamps
 *     champs={champs}
 *     onChange={(cle, visible) => {
 *       if (cle === "pays") setPaysMasques(visible ? new Set() : new Set(pays))
 *       if (cle === "grossiste") setGrossistesMasques(visible ? new Set() : new Set(grossistes))
 *     }}
 *   />
 *
 * `minActifs` (1 par defaut) garantit qu'il reste au moins un champ avec un
 * element visible : le clic qui retirerait le dernier champ actif est ignore.
 */

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { useLocale, useTranslations } from "next-intl"
import { Check, Minus, SlidersHorizontal } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { trierParLibelle } from "@/lib/tri/libelles"

export interface ChampMenu {
  cle: string
  libelle: string
  /** Nombre d'elements du champ. */
  total: number
  /** Nombre d'elements masques (0..total). */
  masques: number
}

export interface MenuChampsProps {
  champs: ChampMenu[]
  /** visible=false : masquer TOUS les elements du champ ; visible=true : les afficher tous. */
  onChange: (cle: string, visible: boolean) => void
  /** Nombre minimum de champs actifs (au moins un element visible). Defaut 1. */
  minActifs?: number
  /** Remplace le libelle du bouton (defaut : t('bouton')). */
  libelle?: string
  align?: "start" | "center" | "end"
  className?: string
}

export type EtatChamp = "tous" | "aucun" | "partiel"

/** tous : rien de masque ; aucun : tout masque (ou champ vide) ; partiel sinon. */
export function etatChamp(champ: ChampMenu): EtatChamp {
  if (champ.total <= 0) return "aucun"
  if (champ.masques <= 0) return "tous"
  if (champ.masques >= champ.total) return "aucun"
  return "partiel"
}

/** Un champ est actif s'il a au moins un element visible. */
function estActif(champ: ChampMenu): boolean {
  return champ.total > 0 && champ.masques < champ.total
}

export function MenuChamps({
  champs,
  onChange,
  minActifs = 1,
  libelle,
  align = "start",
  className,
}: MenuChampsProps) {
  const t = useTranslations("mobilePivots.champs")
  const locale = useLocale()
  // Entrees de A a Z sur le libelle affiche, dans la langue de l'ecran.
  const champsTries = React.useMemo(() => trierParLibelle(champs, (c) => c.libelle, locale), [champs, locale])
  const idAide = React.useId()

  const nomBouton = libelle ?? t("bouton")
  const nbActifs = champs.filter(estActif).length
  const nbRetires = champs.filter((c) => etatChamp(c) === "aucun").length
  const toutComplet = champs.every((c) => etatChamp(c) === "tous")
  const minAtteint = minActifs > 0 && nbActifs <= minActifs

  const basculer = (champ: ChampMenu) => {
    if (champ.total <= 0) return
    if (etatChamp(champ) === "tous") {
      // Retirer ce champ ferait passer les champs actifs sous le minimum.
      if (nbActifs - 1 < minActifs) return
      onChange(champ.cle, false)
    } else {
      onChange(champ.cle, true)
    }
  }

  const toutAfficher = () => {
    for (const champ of champs) {
      if (champ.total > 0 && etatChamp(champ) !== "tous") onChange(champ.cle, true)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-11 gap-1.5 md:h-9", className)}
          aria-label={nomBouton}
          title={t("titre")}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{nomBouton}</span>
          {nbRetires > 0 && (
            <Badge variant="secondary" className="ms-0.5 px-1.5 tabular-nums">
              {t("retires", { count: nbRetires })}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        collisionPadding={16}
        className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-3"
      >
        <fieldset className="space-y-3" aria-describedby={idAide}>
          <legend className="p-0 text-sm font-semibold">{t("titre")}</legend>
          <p id={idAide} className="text-xs text-muted-foreground">
            {t("aide")}
          </p>

          <Button
            variant="ghost"
            size="sm"
            className="h-11 px-2 text-xs md:h-8"
            disabled={toutComplet}
            onClick={toutAfficher}
          >
            {t("afficherTout")}
          </Button>

          <div className="space-y-0.5">
            {champsTries.map((champ) => {
              const etat = etatChamp(champ)
              const vide = champ.total <= 0
              const bloque = etat === "tous" && nbActifs - 1 < minActifs
              const affiches = Math.max(0, champ.total - champ.masques)
              return (
                <label
                  key={champ.cle}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 md:min-h-8"
                >
                  <CheckboxPrimitive.Root
                    checked={etat === "tous" ? true : etat === "partiel" ? "indeterminate" : false}
                    onCheckedChange={() => basculer(champ)}
                    disabled={vide}
                    aria-disabled={bloque ? true : undefined}
                    className="peer relative h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-60 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-3.5 [@media(pointer:coarse)]:after:content-['']"
                  >
                    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
                      {etat === "partiel" ? (
                        <Minus className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      )}
                    </CheckboxPrimitive.Indicator>
                  </CheckboxPrimitive.Root>
                  <span className="min-w-0 flex-1 break-words">
                    <span className="block">{champ.libelle}</span>
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {t("detail", { affiches, total: champ.total })}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          {/* Region toujours presente pour que l'annonce soit lue au changement. */}
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {minAtteint ? t("minimum", { count: minActifs }) : null}
          </p>
        </fieldset>
      </PopoverContent>
    </Popover>
  )
}
