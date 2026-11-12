'use client'

/**
 * Rendu d'un graphique d'artefact : option ECharts calculée par `construireOptionGraphique`,
 * avertissements discrets, état vide, sélecteur de forme et export PNG.
 *
 * Accessibilité : le tracé est un `figure role="img"` dont le nom décrit le titre, la forme, les
 * mesures et le nombre de points. Le parent propose le tableau des valeurs (« voir en tableau »),
 * qui est l'alternative complète au tracé.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ChartNoAxesColumn, Info } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { getDirection } from '@/i18n/config'
import { construireOptionGraphique } from '@/lib/medic-assist/artefacts/graphique-option'
import { MAX_CATEGORIES_SECTEURS, compterCategories } from '@/lib/medic-assist/artefacts/recommandations-forme'

import { EchartsReact } from './echarts-react'
import { SelecteurForme } from './selecteur-forme'

import type { EchartsReactHandle } from './echarts-react'
import type { InfoChangementForme } from './selecteur-forme'
import type { GraphiqueSpec } from '@/lib/medic-assist/contrats'
import type {
  AvertissementGraphique,
  JeuClient,
  ResultatOptionGraphique,
  Traducteur,
} from '@/lib/medic-assist/artefacts/types-rendu'

export interface RenduGraphiqueProps {
  titre: string
  spec: GraphiqueSpec
  jeu: JeuClient
  /** Le lecteur peut changer la forme (propriétaire de l'artefact). */
  modifiable?: boolean
  onSpecChange?: (spec: GraphiqueSpec) => void
  /** Hauteur du tracé en pixels ; par défaut 320 (240 en compact, plus haute en barres horizontales). */
  hauteur?: number
  compact?: boolean
  /** Masque le sélecteur de forme même si `modifiable`. */
  sansSelecteur?: boolean
}

export interface RenduGraphiqueHandle {
  telechargerPng(nomBase: string): Promise<void>
  versDataUrl(): string | null
}

const HAUTEUR_DEFAUT = 320
const HAUTEUR_COMPACTE = 240
const HAUTEUR_MAX_BARRES = 640
const HAUTEUR_PAR_BARRE = 28

/** Hauteur adaptée : les barres horizontales grandissent avec le nombre de catégories. */
export function hauteurParDefaut(
  forme: string,
  nbCategories: number,
  compact: boolean
): number {
  const base = compact ? HAUTEUR_COMPACTE : HAUTEUR_DEFAUT
  if (forme !== 'barres_horizontales') return base
  return Math.min(HAUTEUR_MAX_BARRES, Math.max(base, 80 + nbCategories * HAUTEUR_PAR_BARRE))
}

/** Thème de l'application : sombre seulement si `<html>` porte la classe `dark`. */
function useThemeGraphique(): 'clair' | 'sombre' {
  const [theme, setTheme] = useState<'clair' | 'sombre'>('clair')
  useEffect(() => {
    const racine = document.documentElement
    const lire = () => setTheme(racine.classList.contains('dark') ? 'sombre' : 'clair')
    lire()
    if (typeof MutationObserver === 'undefined') return
    const observateur = new MutationObserver(lire)
    observateur.observe(racine, { attributes: true, attributeFilter: ['class'] })
    return () => observateur.disconnect()
  }, [])
  return theme
}

/** Titre et description accessibles que l'option porte déjà (titre masqué et `aria.label`). */
function descriptionAccessible(option: Record<string, unknown>): string {
  const titres = option.title
  const titre =
    Array.isArray(titres) && typeof (titres[0] as { text?: unknown } | undefined)?.text === 'string'
      ? ((titres[0] as { text: string }).text)
      : ''
  const aria = option.aria as { label?: { description?: unknown } } | undefined
  const description = typeof aria?.label?.description === 'string' ? aria.label.description : ''
  return [titre, description].filter(Boolean).join(', ')
}

export const RenduGraphique = forwardRef<RenduGraphiqueHandle, RenduGraphiqueProps>(
  function RenduGraphique(
    { titre, spec, jeu, modifiable = false, onSpecChange, hauteur, compact = false, sansSelecteur = false },
    ref
  ) {
    const t = useTranslations('medicAssistArtefacts')
    const locale = useLocale()
    const rtl = getDirection(locale) === 'rtl'
    const theme = useThemeGraphique()
    const graphique = useRef<EchartsReactHandle | null>(null)

    // Traducteur stable : l'option n'est recalculée que si ses vraies entrées changent.
    const tRef = useRef(t)
    useEffect(() => {
      tRef.current = t
    })
    const traduire = useCallback<Traducteur>((cle, valeurs) => tRef.current(cle as never, valeurs as never), [])

    const resultat: ResultatOptionGraphique = useMemo(
      () => construireOptionGraphique(spec, jeu, { locale, theme, rtl, traduire, compact }),
      [spec, jeu, locale, theme, rtl, traduire, compact]
    )

    const nomForme = (forme: unknown): string => t(`graphique.forme.${String(forme)}` as never)

    const texteAvertissement = (a: AvertissementGraphique): string | null => {
      const v = a.valeurs ?? {}
      switch (a.code) {
        case 'forme_changee':
          return t('graphiqueUi.avertissements.forme_changee', {
            vers: nomForme(v.vers ?? 'barres_horizontales'),
            max: MAX_CATEGORIES_SECTEURS,
          })
        case 'limite_appliquee':
          return t('graphiqueUi.avertissements.limite_appliquee', {
            n: Number(v.n ?? 0),
            total: Number(v.total ?? 0),
          })
        case 'serie_ignoree':
          return t('graphiqueUi.avertissements.serie_ignoree', {
            n: Number(v.n ?? 0),
            forme: nomForme(v.forme ?? spec.forme),
          })
        default:
          return null // donnees_vides : rendu par l'état vide
      }
    }
    const avertissements = resultat.avertissements
      .map(a => ({ code: a.code, texte: texteAvertissement(a) }))
      .filter((a): a is { code: typeof a.code; texte: string } => a.texte !== null)

    const nbCategories = Math.min(
      compterCategories(spec, jeu),
      spec.limite && spec.limite > 0 ? spec.limite + 1 : Number.POSITIVE_INFINITY
    )
    const hauteurFinale = hauteur ?? hauteurParDefaut(resultat.formeEffective, nbCategories, compact)

    const description = descriptionAccessible(resultat.option)
    const nomAccessible = description
      ? t('graphiqueUi.ariaLabel', { titre, description })
      : titre

    const versDataUrl = useCallback((): string | null => {
      return (
        graphique.current?.getDataURL({
          type: 'png',
          pixelRatio: 2,
          backgroundColor: theme === 'sombre' ? '#16233a' : '#fff',
        }) ?? null
      )
    }, [theme])

    useImperativeHandle(
      ref,
      () => ({
        versDataUrl,
        async telechargerPng(nomBase: string) {
          const url = versDataUrl()
          if (!url) {
            toast.error(tRef.current('graphiqueUi.pngIndisponible' as never))
            return
          }
          const lien = document.createElement('a')
          lien.href = url
          lien.download = `${nomBase}.png`
          document.body.appendChild(lien)
          lien.click()
          lien.remove()
        },
      }),
      [versDataUrl]
    )

    const surChangementForme = (nouvelle: GraphiqueSpec, info: InfoChangementForme) => {
      if (info.motif) {
        const motif = t(`graphiqueUi.motifs.${info.motif}` as never, { max: MAX_CATEGORIES_SECTEURS } as never)
        if (info.formeEffective === spec.forme) {
          toast.info(t('graphiqueUi.changement.refuse', { motif }))
          return
        }
        toast.info(
          t('graphiqueUi.changement.remplace', { forme: nomForme(info.formeEffective), motif })
        )
      }
      onSpecChange?.(nouvelle)
    }

    return (
      <div className="min-w-0 space-y-2" dir={rtl ? 'rtl' : 'ltr'}>
        {modifiable && !sansSelecteur && (
          <SelecteurForme spec={spec} jeu={jeu} onChange={surChangementForme} />
        )}

        {avertissements.length > 0 && (
          <ul
            aria-label={t('graphiqueUi.avertissements.liste')}
            className="m-0 list-none space-y-1 p-0 text-xs text-muted-foreground"
          >
            {avertissements.map(a => (
              <li key={a.code} className="flex items-start gap-1.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{a.texte}</span>
              </li>
            ))}
          </ul>
        )}

        {resultat.vide ? (
          <div
            role="status"
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 p-4 text-center"
            style={{ minHeight: hauteurFinale }}
          >
            <ChartNoAxesColumn className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-semibold text-foreground">{t('graphiqueUi.videTitre')}</p>
            <p className="max-w-xs text-xs text-muted-foreground">{t('graphiqueUi.videAide')}</p>
          </div>
        ) : (
          <figure role="img" aria-label={nomAccessible} className="m-0 min-w-0">
            <EchartsReact ref={graphique} option={resultat.option} hauteur={hauteurFinale} />
          </figure>
        )}
      </div>
    )
  }
)
