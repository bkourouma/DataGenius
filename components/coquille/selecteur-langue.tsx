'use client'

import { useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronDown, Languages } from 'lucide-react'
import { changerLangue } from '@/i18n/actions'
import { isLocale, LOCALE_NAMES, locales } from '@/i18n/config'
import { cn } from '@/lib/utils'

/**
 * Sélecteur de langue de l'interface.
 *
 * Liste native (<select>) : clavier, lecteurs d'écran, sens d'écriture et tiroir
 * mobile fonctionnent sans code spécifique. Chaque langue est écrite dans sa propre
 * langue (attribut `lang` sur l'option). Le choix pose le cookie, puis
 * `router.refresh()` retraduit la page sans rechargement complet.
 *
 * - `rail` : bouton icône discret pour le pied sombre du rail ;
 * - `page` : liste visible, lisible sur fond clair (page de connexion).
 */
export function SelecteurLangue({ variante, className }: { variante: 'rail' | 'page'; className?: string }) {
  const t = useTranslations('ecrans.langue')
  const langue = useLocale()
  const router = useRouter()
  const [enCours, setEnCours] = useState(false)

  async function surChoix(e: ChangeEvent<HTMLSelectElement>) {
    const valeur = e.target.value
    if (!isLocale(valeur) || valeur === langue) return
    setEnCours(true)
    try {
      const { ok } = await changerLangue(valeur)
      if (ok) router.refresh()
    } catch {
      // Le choix n'a pas pu être enregistré : la langue reste celle affichée.
    } finally {
      setEnCours(false)
    }
  }

  const liste = (
    <select
      aria-label={t('libelle')}
      title={t('libelle')}
      value={isLocale(langue) ? langue : undefined}
      onChange={surChoix}
      disabled={enCours}
      className={cn(
        variante === 'rail'
          ? 'absolute inset-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-wait'
          : 'h-10 w-full cursor-pointer appearance-none rounded-md border border-input bg-background ps-9 pe-8 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60',
      )}
    >
      {locales.map((code) => (
        <option key={code} value={code} lang={code} dir={code === 'ar' ? 'rtl' : 'ltr'} className="bg-white text-slate-900">
          {LOCALE_NAMES[code]}
        </option>
      ))}
    </select>
  )

  if (variante === 'rail') {
    return (
      <span
        className={cn(
          'cible-tactile relative flex size-8 shrink-0 items-center justify-center rounded-md text-shell-muted transition-colors focus-within:ring-2 focus-within:ring-blue-300 hover:bg-white/[0.07] hover:text-white',
          enCours && 'opacity-60',
          className,
        )}
      >
        <Languages className="size-4" aria-hidden />
        {liste}
      </span>
    )
  }

  return (
    <span className={cn('relative inline-flex w-40 items-center text-foreground', className)}>
      <Languages className="pointer-events-none absolute start-3 size-4 text-muted-foreground" aria-hidden />
      {liste}
      <ChevronDown className="pointer-events-none absolute end-3 size-4 text-muted-foreground" aria-hidden />
    </span>
  )
}
