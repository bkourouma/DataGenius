"use client"

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { ArrowRight, BookMarked, Sparkles } from 'lucide-react'
import { listerAnalysesApi } from '@/components/medic-assist/suivi/api-analyses'
import { useRaccourciPalette } from '@/components/coquille/raccourci'
import { questionsDepart } from './questions-depart'

export interface AccueilProps {
  prenom?: string
  roleName?: string
  onPoser: (question: string) => void
}

/** Premier mot d'un nom complet ; undefined s'il est vide. */
export function premierMot(nom?: string | null): string | undefined {
  return nom?.trim().split(/\s+/)[0] || undefined
}

/** Les quatre dernieres analyses enregistrees, pour reprendre la ou on s'etait arrete. */
function AnalysesRecentes() {
  const t = useTranslations('medicAssist')
  const format = useFormatter()
  const { data } = useQuery({
    queryKey: ['medic-assist', 'accueil', 'analyses-recentes'],
    queryFn: ({ signal }) => listerAnalysesApi({ q: '', page: 1 }, signal),
    staleTime: 60_000,
    retry: false,
  })
  const analyses = data?.data.slice(0, 4) ?? []
  if (!analyses.length) return null

  return (
    <section aria-labelledby="analyses-recentes-titre" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="analyses-recentes-titre" className="text-sm font-semibold">
          {t('accueil.analysesTitre')}
        </h2>
        <Link href="/medic-assist/analyses" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          {t('accueil.toutVoir')}
          <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {analyses.map((analyse) => (
          <li key={analyse.artefactId}>
            <Link
              href={`/medic-assist/analyses/${encodeURIComponent(analyse.artefactId)}`}
              className="flex items-center gap-3 px-3 py-2.5 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <BookMarked className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{analyse.titre}</span>
              <time dateTime={analyse.enregistreeLe} className="shrink-0 text-xs text-muted-foreground">
                {format.relativeTime(new Date(analyse.enregistreeLe))}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Salutation du lanceur. */
export function AccueilEnTete({ prenom }: { prenom?: string }) {
  const t = useTranslations('medicAssist')
  const mot = premierMot(prenom)
  return (
    <header className="space-y-1">
      <h1 className="text-balance text-[1.75rem] font-semibold leading-tight tracking-tight">
        {mot ? t('accueil.salutation', { prenom: mot }) : t('accueil.salutationSansNom')}
      </h1>
      <p className="text-muted-foreground">{t('accueil.sousTitre')}</p>
    </header>
  )
}

/** Sous le champ de question : questions de depart, analyses recentes, astuce clavier. */
export function AccueilSuite({ onPoser }: { onPoser: (question: string) => void }) {
  const t = useTranslations('medicAssist')
  const cles = questionsDepart()
  const raccourci = useRaccourciPalette()

  return (
    <>
      <section aria-labelledby="questions-depart-titre" className="space-y-2">
        <h2 id="questions-depart-titre" className="text-sm font-semibold">
          {t('accueil.questionsTitre')}
        </h2>
        <ul aria-label={t('accueil.questionsListe')} className="flex flex-wrap gap-2">
          {cles.map((cle) => {
            const texte = t(cle as never)
            return (
              <li key={cle} className="flex max-w-full">
                <button
                  type="button"
                  onClick={() => onPoser(texte)}
                  className="cible-tactile inline-flex max-w-full items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-start text-sm transition-colors hover:border-primary/40 hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0">{texte}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <AnalysesRecentes />

      <p className="text-xs text-muted-foreground max-lg:hidden">{t('accueil.astuce', { raccourci })}</p>
    </>
  )
}

/** Accueil complet sans champ (conversation en lecture seule). */
export function Accueil({ prenom, onPoser }: AccueilProps) {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 pb-4 pt-[6vh] sm:pt-[12vh]">
      <AccueilEnTete prenom={prenom} />
      <AccueilSuite onPoser={onPoser} />
    </div>
  )
}
