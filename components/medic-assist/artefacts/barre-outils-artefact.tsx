'use client'

import { Calculator, Check, Copy } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { useConteneurLarge } from './use-conteneur-large'

import { MenuTelechargement } from './menu-telechargement'
import { SelecteurVersion } from './selecteur-version'
import type { EtatEnregistrement } from './use-artefact'
import type { ArtefactClient } from '@/lib/medic-assist/artefacts/types-rendu'

export type ModeVueArtefact = 'natif' | 'tableau'

interface BarreOutilsArtefactProps {
  artefact: ArtefactClient
  versionAffichee: number
  onChoisirVersion: (version: number) => void
  vue: ModeVueArtefact
  onVue: (vue: ModeVueArtefact) => void
  /** Vrai si un tableau est affiché (copie TSV possible). */
  copiable: boolean
  onCopier: () => void
  onTelechargerPng?: (nomBase: string) => Promise<void>
  provenanceOuverte: boolean
  idProvenance: string
  onProvenance: () => void
  enregistrement: EtatEnregistrement
  /** Emplacement du lot 5 (Épingler, Planifier…). */
  actions?: ReactNode
}

/** Largeur de conteneur à partir de laquelle les libellés des actions s'affichent. */
export const LARGEUR_LIBELLES_BARRE = 560;

/**
 * Étiquette réduite à l'icône (nom accessible conservé, `title` en info-bulle) : le panneau est
 * étroit (~480 px) et la barre d'actions doit tenir sur deux rangées au plus.
 */
function Etiquette({ children, visible }: { children: ReactNode; visible: boolean }) {
  return <span className={visible ? undefined : 'sr-only'}>{children}</span>
}

export function BarreOutilsArtefact({
  artefact,
  versionAffichee,
  onChoisirVersion,
  vue,
  onVue,
  copiable,
  onCopier,
  onTelechargerPng,
  provenanceOuverte,
  idProvenance,
  onProvenance,
  enregistrement,
  actions,
}: BarreOutilsArtefactProps) {
  const t = useTranslations('medicAssistArtefacts')
  const { ref, large } = useConteneurLarge<HTMLDivElement>(LARGEUR_LIBELLES_BARRE);

  const texteEnregistrement =
    enregistrement === 'en_cours'
      ? t('panneau.enregistrement.enCours')
      : enregistrement === 'enregistre'
        ? t('panneau.enregistrement.enregistre')
        : enregistrement === 'erreur'
          ? t('panneau.enregistrement.erreur')
          : ''

  return (
    <div ref={ref} className="flex flex-wrap items-center gap-2">
      <SelecteurVersion
        versions={artefact.versions}
        versionAffichee={versionAffichee}
        onChoisir={onChoisirVersion}
      />

      {artefact.type === 'graphique' ? (
        <div role="group" aria-label={t('panneau.vue.groupe')} className="flex rounded-md border border-border">
          {(['natif', 'tableau'] as const).map(v => (
            <button
              key={v}
              type="button"
              aria-pressed={vue === v}
              onClick={() => onVue(v)}
              className={cn(
                'h-9 px-3 text-sm first:rounded-s-md last:rounded-e-md [@media(pointer:coarse)]:min-h-11',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                vue === v
                  ? 'bg-secondary font-semibold text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              )}
            >
              {v === 'natif' ? t('panneau.vue.graphique') : t('panneau.vue.tableau')}
            </button>
          ))}
        </div>
      ) : null}

      <div className="ms-auto flex flex-wrap items-center gap-2">
        <span
          role="status"
          aria-live="polite"
          className={cn(
            'text-xs',
            enregistrement === 'erreur' ? 'font-semibold text-destructive' : 'text-muted-foreground'
          )}
        >
          {enregistrement === 'enregistre' ? (
            <Check aria-hidden className="me-1 inline size-3.5" />
          ) : null}
          {texteEnregistrement}
        </span>

        <MenuTelechargement
          artefactId={artefact.id}
          titre={artefact.titre}
          type={artefact.type}
          version={versionAffichee}
          onTelechargerPng={onTelechargerPng}
        />

        {copiable ? (
          <Button type="button" variant="outline" size="sm" onClick={onCopier} title={t('panneau.copier')} className="cible-tactile">
            <Copy aria-hidden />
            <Etiquette visible={large}>{t('panneau.copier')}</Etiquette>
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={provenanceOuverte}
          aria-controls={idProvenance}
          onClick={onProvenance}
          title={t('panneau.comment')}
          className="cible-tactile"
        >
          <Calculator aria-hidden />
          <Etiquette visible={large}>{t('panneau.comment')}</Etiquette>
        </Button>

        {/* Actions secondaires (Enregistrer, Épingler, Partager, Programmer) : icônes seules sur une
            rangée ; les noms accessibles (aria-label) et les info-bulles restent ceux du lot 5. */}
        <div
          data-testid="actions-secondaires"
          className={cn(
            'flex items-center [&_[role=group]]:flex-nowrap [&_[role=group]]:gap-1',
            !large && '[&_button>span]:!hidden',
            '[&_button]:max-md:min-h-11 [&_button]:max-md:min-w-11'
          )}
        >
          {actions}
        </div>
      </div>
    </div>
  )
}
