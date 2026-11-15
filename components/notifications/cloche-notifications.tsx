'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, Check } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { toIntlTag } from '@/i18n/config'

interface NotificationCloche {
  id: string
  type: string
  titre: string
  message: string
  lue: boolean
  creeLe: string
  lien: string | null
}

type Statut = 'chargement' | 'pret' | 'erreur'

const INTERVALLE_MS = 60_000

/** Date relative dans la langue courante, avec repli sur une date absolue. */
export function dateRelative(iso: string, locale: string, maintenant: number = Date.now()): string {
  const tag = toIntlTag(locale)
  const instant = new Date(iso).getTime()
  if (Number.isNaN(instant)) return ''
  try {
    const secondes = Math.round((instant - maintenant) / 1000)
    const format = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' })
    const paliers: [Intl.RelativeTimeFormatUnit, number][] = [
      ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800],
      ['day', 86_400], ['hour', 3_600], ['minute', 60],
    ]
    for (const [unite, taille] of paliers) {
      if (Math.abs(secondes) >= taille) return format.format(Math.round(secondes / taille), unite)
    }
    return format.format(Math.min(secondes, 0), 'second')
  } catch {
    try {
      return new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(instant))
    } catch {
      return new Date(instant).toISOString()
    }
  }
}

export function ClocheNotifications() {
  const t = useTranslations('notifications')
  const locale = useLocale()
  const [ouvert, setOuvert] = useState(false)
  const [statut, setStatut] = useState<Statut>('chargement')
  const [notifications, setNotifications] = useState<NotificationCloche[]>([])
  const [nonLues, setNonLues] = useState(0)
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const version = useRef(0)

  const charger = useCallback(async () => {
    const numero = ++version.current
    try {
      const reponse = await fetch('/api/notifications', { cache: 'no-store' })
      if (reponse.status === 401) return
      if (!reponse.ok) throw new Error('statut')
      const corps = await reponse.json() as { data?: { nonLues: number; notifications: NotificationCloche[] } }
      if (!corps.data || numero !== version.current) return
      setNotifications(corps.data.notifications)
      setNonLues(corps.data.nonLues)
      setMaintenant(Date.now())
      setStatut('pret')
    } catch {
      if (numero === version.current) setStatut(precedent => precedent === 'pret' ? precedent : 'erreur')
    }
  }, [])

  useEffect(() => {
    void charger()
    const minuteur = setInterval(() => {
      if (document.visibilityState === 'visible') void charger()
    }, INTERVALLE_MS)
    return () => clearInterval(minuteur)
  }, [charger])

  function changerOuverture(valeur: boolean) {
    setOuvert(valeur)
    if (valeur) {
      setStatut(precedent => precedent === 'erreur' ? 'chargement' : precedent)
      void charger()
    }
  }

  async function envoyerLu(corps: { id: string } | { tous: true }) {
    // Mise à jour optimiste ; l'invalidation du chargement en cours évite qu'il écrase l'état.
    version.current++
    try {
      const reponse = await fetch('/api/notifications/lu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
        keepalive: true,
      })
      if (reponse.ok) {
        const retour = await reponse.json() as { data?: { nonLues: number } }
        if (retour.data) setNonLues(retour.data.nonLues)
      } else {
        void charger()
      }
    } catch {
      void charger()
    }
  }

  function marquerLue(id: string) {
    const cible = notifications.find(n => n.id === id)
    if (!cible || cible.lue) return
    setNotifications(liste => liste.map(n => n.id === id ? { ...n, lue: true } : n))
    setNonLues(nombre => Math.max(0, nombre - 1))
    void envoyerLu({ id })
  }

  function toutMarquerLu() {
    setNotifications(liste => liste.map(n => ({ ...n, lue: true })))
    setNonLues(0)
    void envoyerLu({ tous: true })
  }

  const compteur = nonLues > 99 ? '99+' : String(nonLues)

  return (
    <PopoverPrimitive.Root open={ouvert} onOpenChange={changerOuverture}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={t('cloche.ouvrir', { nombre: nonLues })}
          title={t('cloche.titre')}
          className="cible-tactile relative flex size-8 items-center justify-center rounded-md text-shell-muted transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          <Bell className="size-4" aria-hidden />
          {nonLues > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white tabular-nums"
            >
              {compteur}
            </span>
          )}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          aria-label={t('cloche.titre')}
          className="z-50 flex max-h-[min(32rem,calc(100dvh-2rem))] w-[min(22rem,calc(100vw-1rem))] flex-col rounded-md border bg-popover text-popover-foreground shadow-md outline-none"
        >
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <h2 className="text-sm font-semibold">{t('cloche.titre')}</h2>
            {nonLues > 0 && (
              <button
                type="button"
                onClick={toutMarquerLu}
                className="cible-tactile rounded-md px-2 py-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('cloche.toutLu')}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {statut === 'chargement' && (
              <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{t('cloche.chargement')}</p>
            )}
            {statut === 'erreur' && (
              <div role="alert" className="space-y-2 px-3 py-6 text-center text-sm">
                <p>{t('cloche.erreur')}</p>
                <button
                  type="button"
                  onClick={() => { setStatut('chargement'); void charger() }}
                  className="cible-tactile rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('cloche.reessayer')}
                </button>
              </div>
            )}
            {statut === 'pret' && notifications.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('cloche.vide')}</p>
            )}
            {statut === 'pret' && notifications.length > 0 && (
              <ul className="divide-y">
                {notifications.map(n => (
                  <li key={n.id} className="flex items-start gap-2 px-3 py-2.5">
                    <span className="mt-1.5 flex size-2 shrink-0 items-center justify-center" aria-hidden>
                      {!n.lue && <span className="size-2 rounded-full bg-blue-500" />}
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className={n.lue ? 'text-sm' : 'text-sm font-semibold'}>
                        {!n.lue && <span className="sr-only">{t('cloche.nonLue')} : </span>}
                        {n.titre}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">{n.message}</p>
                      <p className="text-xs text-muted-foreground">
                        <time dateTime={n.creeLe}>{dateRelative(n.creeLe, locale, maintenant)}</time>
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3">
                        {n.lien && (
                          <Link
                            href={n.lien}
                            onClick={() => { marquerLue(n.id); setOuvert(false) }}
                            className="cible-tactile inline-flex items-center rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {t('cloche.ouvrirLien')}
                          </Link>
                        )}
                        {!n.lue && (
                          <button
                            type="button"
                            onClick={() => marquerLue(n.id)}
                            className="cible-tactile inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Check className="size-3" aria-hidden />
                            {t('cloche.marquerLu')}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
