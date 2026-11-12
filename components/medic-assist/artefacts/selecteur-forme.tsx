'use client'

/**
 * Sélecteur de forme d'un graphique : un clic change la forme sans rappeler l'IA.
 *
 * Choix d'accessibilité : barre d'outils (`role="toolbar"`) de boutons à bascule (`aria-pressed`),
 * plutôt qu'un groupe de boutons radio : chaque forme est une action qui s'applique tout de suite
 * et la forme courante est un état « enfoncé ». Une seule tabulation (tabindex itinérant) puis
 * flèches, Début et Fin ; en arabe les flèches suivent le sens visuel.
 *
 * Une forme indisponible reste focalisable (`aria-disabled`) : son info-bulle et le toast du
 * parent expliquent le motif, ce qu'un bouton `disabled` ne permettrait ni au clavier ni au tactile.
 */

import { useMemo, useRef, useState } from 'react'
import {
  ChartArea,
  ChartBarBig,
  ChartColumnBig,
  ChartColumnStacked,
  ChartLine,
  ChartNoAxesCombined,
  ChartPie,
  ChartScatter,
  Donut,
  Funnel,
  Gauge,
  Grid3x3,
  LayoutPanelTop,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { getDirection } from '@/i18n/config'
import { cn } from '@/lib/utils'
import { MAX_CATEGORIES_SECTEURS, appliquerChangementForme, formesProposees } from '@/lib/medic-assist/artefacts/recommandations-forme'

import type { FormeGraphique, GraphiqueSpec } from '@/lib/medic-assist/contrats'
import type { MotifForme } from '@/lib/medic-assist/artefacts/recommandations-forme'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'
import type { LucideIcon } from 'lucide-react'

export interface InfoChangementForme {
  formeEffective: FormeGraphique
  motif?: MotifForme
}

export interface SelecteurFormeProps {
  spec: GraphiqueSpec
  jeu: JeuClient
  onChange: (spec: GraphiqueSpec, info: InfoChangementForme) => void
  disabled?: boolean
}

/** Une icône distincte par forme. */
export const ICONES_FORMES: Record<FormeGraphique, LucideIcon> = {
  barres: ChartColumnBig,
  barres_empilees: ChartColumnStacked,
  barres_horizontales: ChartBarBig,
  lignes: ChartLine,
  aires: ChartArea,
  secteurs: ChartPie,
  anneau: Donut,
  nuage: ChartScatter,
  combine: ChartNoAxesCombined,
  carte_chaleur: Grid3x3,
  treemap: LayoutPanelTop,
  entonnoir: Funnel,
  jauge: Gauge,
}

export function SelecteurForme({ spec, jeu, onChange, disabled = false }: SelecteurFormeProps) {
  const t = useTranslations('medicAssistArtefacts')
  const locale = useLocale()
  const rtl = getDirection(locale) === 'rtl'
  const formes = useMemo(() => formesProposees(spec, jeu), [spec, jeu])
  const boutons = useRef<(HTMLButtonElement | null)[]>([])
  const indexCourant = Math.max(
    0,
    formes.findIndex(f => f.forme === spec.forme)
  )
  const [focus, setFocus] = useState<number | null>(null)
  const indexTab = focus !== null && focus < formes.length ? focus : indexCourant

  const choisir = (forme: FormeGraphique) => {
    if (disabled || forme === spec.forme) return
    const resultat = appliquerChangementForme(spec, forme, jeu)
    onChange(resultat.spec, {
      formeEffective: resultat.formeEffective,
      ...(resultat.motif ? { motif: resultat.motif } : {}),
    })
  }

  const deplacer = (index: number) => {
    const total = formes.length
    const cible = (index + total) % total
    setFocus(cible)
    boutons.current[cible]?.focus()
  }

  const surTouche = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const suivant = rtl ? 'ArrowLeft' : 'ArrowRight'
    const precedent = rtl ? 'ArrowRight' : 'ArrowLeft'
    if (e.key === suivant || e.key === 'ArrowDown') deplacer(index + 1)
    else if (e.key === precedent || e.key === 'ArrowUp') deplacer(index - 1)
    else if (e.key === 'Home') deplacer(0)
    else if (e.key === 'End') deplacer(formes.length - 1)
    else return
    e.preventDefault()
  }

  const nomForme = (forme: FormeGraphique) => t(`graphique.forme.${forme}`)

  return (
    <div
      role="toolbar"
      aria-label={t('graphiqueUi.selecteur.libelle')}
      aria-orientation="horizontal"
      dir={rtl ? 'rtl' : 'ltr'}
      className="flex max-w-full flex-wrap items-center gap-1"
    >
      {formes.map((proposee, index) => {
        const { forme } = proposee
        const Icone = ICONES_FORMES[forme]
        const actif = forme === spec.forme
        const indisponible = !proposee.disponible
        const nom = nomForme(forme)
        const libelle =
          indisponible && proposee.motif
            ? t('graphiqueUi.selecteur.indisponible', {
                forme: nom,
                motif: t(`graphiqueUi.motifs.${proposee.motif}`, { max: MAX_CATEGORIES_SECTEURS }),
              })
            : nom
        return (
          <Button
            key={forme}
            ref={el => {
              boutons.current[index] = el
            }}
            type="button"
            variant={actif ? 'default' : 'outline'}
            size="icon"
            className={cn('h-9 w-9 shrink-0', indisponible && 'cursor-not-allowed opacity-50')}
            aria-label={libelle}
            title={libelle}
            aria-pressed={actif}
            aria-disabled={indisponible || undefined}
            disabled={disabled}
            tabIndex={index === indexTab ? 0 : -1}
            onFocus={() => setFocus(index)}
            onKeyDown={e => surTouche(e, index)}
            onClick={() => choisir(forme)}
          >
            <Icone aria-hidden />
          </Button>
        )
      })}
    </div>
  )
}
