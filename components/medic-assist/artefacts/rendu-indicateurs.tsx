'use client'

/**
 * Grille de cartes d'indicateurs : colonnes automatiques d'au moins 15 rem (240 px), donc autant de
 * colonnes que la largeur du conteneur (et non de la fenêtre) le permet : une dans le panneau étroit
 * ou à 375 px, plusieurs en pleine largeur. Les cartes ne sont jamais écrasées sous cette largeur.
 * Les valeurs sont toujours résolues depuis les jeux de données (`resoudreIndicateurs`).
 */

import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { getDirection } from '@/i18n/config'
import { resoudreIndicateurs } from '@/lib/medic-assist/artefacts/indicateurs'

import { CarteIndicateurVue } from './carte-indicateur'

import type { CarteIndicateur } from '@/lib/medic-assist/contrats'
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

export interface RenduIndicateursProps {
  cartes: CarteIndicateur[]
  jeux: Record<string, JeuClient>
}

export function RenduIndicateurs({ cartes, jeux }: RenduIndicateursProps) {
  const t = useTranslations('medicAssistArtefacts.indicateurs')
  const locale = useLocale()
  const resolus = useMemo(() => resoudreIndicateurs(cartes, jeux, locale), [cartes, jeux, locale])
  const dir = getDirection(locale)

  if (resolus.length === 0) {
    return (
      <p dir={dir} className="text-sm text-muted-foreground">
        {t('aucun')}
      </p>
    )
  }

  return (
    <ul
      dir={dir}
      aria-label={t('liste')}
      className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3 p-0"
    >
      {resolus.map((indicateur, index) => (
        <li key={`${index}-${indicateur.libelle}`} className="min-w-0">
          <CarteIndicateurVue indicateur={indicateur} />
        </li>
      ))}
    </ul>
  )
}
