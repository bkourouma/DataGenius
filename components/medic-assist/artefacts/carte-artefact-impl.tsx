'use client'

import { ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import type { TypeArtefact } from '@/lib/medic-assist/contrats'
import type { ArtefactClient } from '@/lib/medic-assist/artefacts/types-rendu'
import { cn } from '@/lib/utils'

import { IconeTypeArtefact } from './onglets-artefacts'
import { useArtefact } from './use-artefact'

export interface CarteArtefactProps {
  artefactId: string
  titre: string
  type: TypeArtefact
  onOuvrir: (artefactId: string) => void
}

/**
 * Carte compacte d'un artefact dans le fil de conversation.
 *
 * Coût : la carte ne charge RIEN à l'affichage (un fil peut en porter des dizaines, et
 * GET /artefacts/[id] renvoie les données). Le résumé (« Tableau · 12 lignes ») se charge
 * une seule fois, au premier survol ou au premier focus. D'ici là, la ligne de résumé
 * montre le type : la hauteur de la carte ne change donc jamais.
 *
 * Accessibilité : un seul arrêt de tabulation (le bouton « Ouvrir », étiré sur toute la
 * carte) ; un clic n'importe où sur la carte ouvre l'artefact.
 */
export function CarteArtefact({ artefactId, titre, type, onOuvrir }: CarteArtefactProps) {
  const t = useTranslations('medicAssistArtefacts')
  const [resumeDemande, setResumeDemande] = useState(false)
  const { artefact, etat } = useArtefact(artefactId, undefined, { actif: resumeDemande })

  const demanderResume = () => {
    if (!resumeDemande) setResumeDemande(true)
  }

  const resume = etat === 'pret' && artefact ? texteResume(artefact, t) : t(`carte.types.${type}`)

  return (
    <div
      data-testid="carte-artefact"
      onMouseEnter={demanderResume}
      onFocus={demanderResume}
      onClick={() => onOuvrir(artefactId)}
      className={cn(
        'group relative flex min-h-[4.5rem] w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-3 text-start shadow-sm',
        'hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2'
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
        <IconeTypeArtefact type={type} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{titre}</span>
        <span className="block min-h-5 truncate text-xs text-muted-foreground" data-figure>
          {resume}
        </span>
      </span>
      <button
        type="button"
        aria-label={t('carte.ouvrirAria', { titre })}
        className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
      >
        {t('carte.ouvrir')}
        <ArrowRight aria-hidden className="size-4 rtl:rotate-180" />
      </button>
    </div>
  )
}

function texteResume(artefact: ArtefactClient, t: ReturnType<typeof useTranslations>): string {
  const spec = artefact.spec
  switch (spec.type) {
    case 'tableau':
      return t('carte.resume.tableau', { n: artefact.jeux[spec.jeuDeDonneesId]?.nbLignes ?? 0 })
    case 'graphique':
      return t('carte.resume.graphique', { forme: t(`graphique.forme.${spec.graphique.forme}`) })
    case 'indicateurs':
      return t('carte.resume.indicateurs', { n: spec.cartes.length })
    default:
      return t('carte.resume.document')
  }
}
