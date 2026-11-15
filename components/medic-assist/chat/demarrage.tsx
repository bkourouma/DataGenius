"use client"

import Link from 'next/link'
import { createContext, useContext, useState, useTransition, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { masquerDemarrage } from '@/app/(dashboard)/assistant/actions'
import type { ValeurDemarrage } from '@/lib/medic-assist/demarrage'

const DemarrageContext = createContext<ValeurDemarrage | null>(null)

export function DemarrageProvider({ valeur, children }: { valeur: ValeurDemarrage | null; children: ReactNode }) {
  return <DemarrageContext.Provider value={valeur}>{children}</DemarrageContext.Provider>
}

export function useDemarrage(): ValeurDemarrage | null {
  return useContext(DemarrageContext)
}

export function Demarrage() {
  const valeur = useDemarrage()
  const t = useTranslations('medicAssist')
  const [masque, setMasque] = useState(false)
  const [enCours, demarrer] = useTransition()

  if (!valeur || masque) return null

  if (valeur.affichage === 'membre-sans-jeu') {
    return (
      <div role="status" className="rounded-md border bg-card px-4 py-3 text-sm">
        <p className="font-semibold">{t('demarrage.membreSansJeu.titre')}</p>
        <p className="mt-1 text-muted-foreground">{t('demarrage.membreSansJeu.texte')}</p>
      </div>
    )
  }

  const faites = valeur.etapes.filter((e) => e.fait).length
  const total = valeur.etapes.length

  function masquer() {
    demarrer(async () => {
      try {
        const res = await masquerDemarrage()
        if (res.ok) setMasque(true)
      } catch {
        // Echec : le guide reste visible.
      }
    })
  }

  return (
    <section aria-labelledby="demarrage-titre" className="rounded-md border bg-card px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="demarrage-titre" className="text-base font-semibold">{t('demarrage.titre')}</h2>
        <p className="text-sm text-muted-foreground">{t('demarrage.progression', { faites, total })}</p>
      </div>
      <ol aria-label={t('demarrage.listeLabel')} className="mt-3 flex flex-col gap-3">
        {valeur.etapes.map((etape, i) => {
          const base = `demarrage.etapes.${etape.cle}`
          return (
            <li key={etape.cle} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ' +
                  (etape.fait ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground')
                }
              >
                {etape.fait ? '✓' : i + 1}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {t(`${base}.libelle` as never)}
                  <span className="sr-only"> — {etape.fait ? t('demarrage.fait') : t('demarrage.aFaire')}</span>
                </p>
                <p className="text-muted-foreground">{t(`${base}.description` as never)}</p>
                {!etape.fait && etape.href ? (
                  <Link
                    href={etape.href}
                    className="cible-tactile mt-1 inline-flex items-center font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t(`${base}.lien` as never)}
                  </Link>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={masquer}
          disabled={enCours}
          className="cible-tactile rounded-md px-3 text-sm text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {t('demarrage.masquer')}
        </button>
      </div>
    </section>
  )
}
