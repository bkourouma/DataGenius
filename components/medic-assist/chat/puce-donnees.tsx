'use client'

import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Provenance } from '@/lib/medic-assist/contrats/donnees'
import { estErreurOutil } from '@/lib/medic-assist/contrats/outils'
import { cn } from '@/lib/utils'
import { VoletProvenance } from './liens-lots'

/** Ce que la puce lit d'une sortie `interroger_donnees` / `requete_sql`. */
export interface SortiePuce {
  nbLignes: number
  provenance: Provenance
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
}

/** Garde de type : une sortie mal formee ne doit jamais faire planter le fil. */
export function lireSortiePuce(sortie: unknown): SortiePuce | null {
  if (!estObjet(sortie) || estErreurOutil(sortie)) return null
  const { nbLignes, provenance } = sortie
  if (typeof nbLignes !== 'number' || !Number.isFinite(nbLignes)) return null
  if (!estObjet(provenance)) return null
  if (typeof provenance.libelleSource !== 'string') return null
  if (!estObjet(provenance.perimetre) || typeof provenance.perimetre.libelle !== 'string') return null
  // Tolerant : filtres, regles et date de calcul absents sont completes plutot que de masquer la puce.
  return {
    nbLignes,
    provenance: {
      ...provenance,
      filtres: Array.isArray(provenance.filtres) ? provenance.filtres : [],
      regles: Array.isArray(provenance.regles) ? provenance.regles : [],
      calculeA: typeof provenance.calculeA === 'string' ? provenance.calculeA : '',
    } as unknown as Provenance,
  }
}

export function PuceDonnees({ sortie, estAdmin }: { sortie: SortiePuce; estAdmin: boolean }) {
  const t = useTranslations('medicAssist.outils')
  const [ouverte, setOuverte] = useState(false)
  const idVolet = useId()
  const periode = sortie.provenance.periode?.libelle
  const libelle = periode
    ? t('puceDonneesPeriode', { count: sortie.nbLignes, periode })
    : t('puceDonnees', { count: sortie.nbLignes })

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setOuverte((v) => !v)}
        aria-expanded={ouverte}
        aria-controls={idVolet}
        title={ouverte ? t('puceDonneesReplier') : t('puceDonneesDeplier')}
        className="cible-tactile inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="truncate" data-figure>
          {libelle}
        </span>
        <ChevronDown
          className={cn('size-3.5 shrink-0 transition-transform motion-reduce:transition-none', ouverte && 'rotate-180')}
          aria-hidden
        />
        <span className="sr-only">{ouverte ? t('puceDonneesReplier') : t('puceDonneesDeplier')}</span>
      </button>
      <div id={idVolet} hidden={!ouverte} className="mt-2">
        {ouverte ? <VoletProvenance provenance={sortie.provenance} estAdmin={estAdmin} /> : null}
      </div>
    </div>
  )
}
