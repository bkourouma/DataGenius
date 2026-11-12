'use client'

/**
 * Carte d'un indicateur résolu, façon `KPICard` du tableau de bord (DESIGN.md « KPI Card ») :
 * lampe carrée de 8 px devant un titre de 14 px discret, chiffre de 30 px en gras (`data-figure`),
 * tendance par icône ET mot, objectif avec badge Atteint / En cours / À risque.
 *
 * Les valeurs sont déjà résolues et formatées (`resoudreIndicateurs`) : rien n'est saisi ni recalculé
 * ici. Le statut vient de `statutObjectif` (valeur >= objectif : atteint ; 90 % à 100 % exclu : en cours).
 * La tendance reste neutre (gris) : une hausse n'est pas toujours une bonne nouvelle, le mot et
 * l'icône disent le sens sans juger.
 */

import { CircleCheck, Clock, Minus, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toIntlTag } from '@/i18n/config'
import { creerFormateur } from '@/lib/medic-assist/artefacts/formats'
import { cn } from '@/lib/utils'

import type { IndicateurResolu, StatutObjectif } from '@/lib/medic-assist/artefacts/types-rendu'
import type { LucideIcon } from 'lucide-react'

export interface CarteIndicateurVueProps {
  indicateur: IndicateurResolu
  className?: string
}

const TIRET = '—'

const LAMPES: Record<StatutObjectif, string> = {
  atteint: 'bg-green-600',
  en_cours: 'bg-yellow-500',
  a_risque: 'bg-red-600',
}

const BADGES: Record<
  StatutObjectif,
  { variante: 'success' | 'warning' | 'danger'; Icone: LucideIcon }
> = {
  atteint: { variante: 'success', Icone: CircleCheck },
  en_cours: { variante: 'warning', Icone: Clock },
  a_risque: { variante: 'danger', Icone: TriangleAlert },
}

const ICONES_TENDANCE: Record<'hausse' | 'baisse' | 'stable', LucideIcon> = {
  hausse: TrendingUp,
  baisse: TrendingDown,
  stable: Minus,
}

export function CarteIndicateurVue({ indicateur, className }: CarteIndicateurVueProps) {
  const t = useTranslations('medicAssistArtefacts.indicateurs')
  const locale = useLocale()
  const { comparaison, objectif } = indicateur

  const formaterVariation = (pct: number, signe: boolean): string =>
    new Intl.NumberFormat(toIntlTag(locale), {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: signe ? 'exceptZero' : 'auto',
    }).format(pct / 100)

  const statut = objectif?.statut ?? null
  const lampe = statut ? LAMPES[statut] : 'bg-slate-400'

  const sens = comparaison?.sens ?? null
  const IconeTendance = ICONES_TENDANCE[sens ?? 'stable']
  const BadgeStatut = statut ? BADGES[statut] : null

  return (
    <Card className={cn('h-full', className)}>
      <CardHeader className="p-3 pb-1 sm:p-5 sm:pb-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-semibold text-muted-foreground">
          <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-[2px]', lampe)} />
          <span className="min-w-0">{indicateur.libelle}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3 pt-0 sm:p-5 sm:pt-0">
        <div
          className="min-w-0 text-2xl font-bold tracking-tight tabular-nums sm:text-3xl"
          data-figure
        >
          {indicateur.valeur === null ? (
            <>
              <span aria-hidden="true">{TIRET}</span>
              <span className="sr-only">{t('donneeIndisponible')}</span>
            </>
          ) : (
            indicateur.valeurFormatee
          )}
        </div>

        {comparaison && (
          <div className="space-y-0.5 text-xs text-muted-foreground sm:text-sm">
            <div className="flex items-center gap-1.5 font-medium">
              <IconeTendance className="h-4 w-4 shrink-0" aria-hidden />
              <span data-figure>
                {comparaison.variationPct === null || sens === null
                  ? t('variationIndisponible')
                  : t('variation', {
                      variation: formaterVariation(
                        sens === 'stable'
                          ? Math.abs(comparaison.variationPct)
                          : comparaison.variationPct,
                        sens !== 'stable'
                      ),
                      sens: t(`tendance.${sens}`),
                    })}
              </span>
            </div>
            <div data-figure>
              {t('reference', {
                libelle: comparaison.libelle,
                valeur: comparaison.valeur === null ? TIRET : comparaison.valeurFormatee,
              })}
            </div>
          </div>
        )}

        {objectif && (
          <div className="space-y-1 text-xs text-muted-foreground sm:text-sm">
            <div data-figure>
              {objectif.libelle
                ? t('objectifNomme', {
                    libelle: objectif.libelle,
                    valeur: objectif.valeur === null ? TIRET : objectif.valeurFormatee,
                  })
                : t('objectif', {
                    valeur: objectif.valeur === null ? TIRET : objectif.valeurFormatee,
                  })}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {objectif.taux === null || statut === null || BadgeStatut === null ? (
                <span>{t('tauxIndisponible')}</span>
              ) : (
                <>
                  <span data-figure>
                    {t('taux', {
                      taux: creerFormateur('pourcentage', locale, { decimales: 1 })(objectif.taux),
                    })}
                  </span>
                  <Badge variant={BadgeStatut.variante}>
                    <BadgeStatut.Icone className="h-3 w-3" aria-hidden />
                    {t(`statut.${statut}`)}
                  </Badge>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
