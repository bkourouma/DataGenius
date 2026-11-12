'use client'

/**
 * Enveloppe React d'ECharts, chargée à la demande (voir `echarts-chargeur.ts`).
 *
 * - Aucun accès à `window` pendant le rendu : l'instance naît dans un effet, après le chargement
 *   dynamique des modules.
 * - `setOption(option, { notMerge: true })` à chaque nouvelle option ; `ResizeObserver` pour suivre
 *   la taille du conteneur ; `dispose()` au démontage.
 * - Chargement : squelette. Échec de chargement : message, bouton « Réessayer » et toast.
 * - `prefers-reduced-motion: reduce` coupe l'animation.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { chargerEcharts } from './echarts-chargeur'

import type { InstanceEcharts, OptionsImageEcharts } from './echarts-chargeur'

import type { OptionGraphique } from '@/lib/medic-assist/artefacts/types-rendu'

export interface EchartsReactHandle {
  /** URL de données de l'image courante, ou null si l'instance n'est pas prête. */
  getDataURL(options?: OptionsImageEcharts): string | null
}

export interface EchartsReactProps {
  option: OptionGraphique
  /** Hauteur du conteneur en pixels. */
  hauteur: number
  renderer?: 'canvas' | 'svg'
  className?: string
}

function animationReduite(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type Etat = 'chargement' | 'pret' | 'erreur'

export const EchartsReact = forwardRef<EchartsReactHandle, EchartsReactProps>(
  function EchartsReact({ option, hauteur, renderer = 'canvas', className }, ref) {
    const t = useTranslations('medicAssistArtefacts')
    // Le traducteur peut changer d'identité à chaque rendu : les effets lisent la dernière version.
    const tRef = useRef(t)
    useEffect(() => {
      tRef.current = t
    })
    const conteneur = useRef<HTMLDivElement | null>(null)
    const instanceRef = useRef<InstanceEcharts | null>(null)
    const [etat, setEtat] = useState<Etat>('chargement')
    const [tentative, setTentative] = useState(0)

    useImperativeHandle(
      ref,
      () => ({
        getDataURL(options) {
          const instance = instanceRef.current
          if (!instance) return null
          try {
            return instance.getDataURL(options)
          } catch {
            return null
          }
        },
      }),
      []
    )

    // Création de l'instance (jamais pendant le rendu).
    useEffect(() => {
      let annule = false
      let instance: InstanceEcharts | null = null
      let observateur: ResizeObserver | null = null
      const noeud = conteneur.current

      chargerEcharts()
        .then(core => {
          if (annule || !noeud) return
          instance = core.init(noeud, null, { renderer }) as InstanceEcharts
          instanceRef.current = instance
          if (typeof ResizeObserver !== 'undefined') {
            observateur = new ResizeObserver(() => instance?.resize())
            observateur.observe(noeud)
          }
          setEtat('pret')
        })
        .catch(() => {
          if (annule) return
          setEtat('erreur')
          toast.error(tRef.current('graphiqueUi.erreurChargement'))
        })

      return () => {
        annule = true
        observateur?.disconnect()
        instanceRef.current = null
        instance?.dispose()
      }
    }, [tentative, renderer])

    // Application de l'option.
    useEffect(() => {
      if (etat !== 'pret') return
      const instance = instanceRef.current
      if (!instance) return
      try {
        instance.setOption(
          animationReduite() ? { ...option, animation: false } : option,
          { notMerge: true }
        )
      } catch {
        setEtat('erreur')
        toast.error(tRef.current('graphiqueUi.erreurChargement'))
      }
    }, [etat, option])

    const reessayer = useCallback(() => {
      setEtat('chargement')
      setTentative(n => n + 1)
    }, [])

    return (
      <div
        className={cn('relative w-full min-w-0', className)}
        style={{ height: hauteur }}
        aria-busy={etat === 'chargement'}
      >
        <div ref={conteneur} className="h-full w-full" />
        {etat === 'chargement' && (
          <div role="status" className="absolute inset-0">
            <Skeleton className="h-full w-full" />
            <span className="sr-only">{t('graphiqueUi.chargement')}</span>
          </div>
        )}
        {etat === 'erreur' && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-card p-4 text-center"
          >
            <TriangleAlert className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-foreground">{t('graphiqueUi.erreurChargement')}</p>
            <Button type="button" variant="outline" size="sm" onClick={reessayer}>
              {t('graphiqueUi.reessayer')}
            </Button>
          </div>
        )}
      </div>
    )
  }
)
