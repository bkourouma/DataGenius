"use client"

import { useTranslations } from 'next-intl'
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

export function Accueil({ prenom, onPoser }: AccueilProps) {
  const t = useTranslations('medicAssist')
  const mot = premierMot(prenom)
  const cles = questionsDepart()

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 py-6 sm:py-10">
      <header>
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">
          {mot ? t('accueil.salutation', { prenom: mot }) : t('accueil.salutationSansNom')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('accueil.sousTitre')}</p>
      </header>

      <section aria-labelledby="questions-depart-titre">
        <h2 id="questions-depart-titre" className="mb-2 text-base font-semibold">
          {t('accueil.questionsTitre')}
        </h2>
        <ul aria-label={t('accueil.questionsListe')} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {cles.map((cle) => {
            const texte = t(cle as never)
            return (
              <li key={cle} className="flex">
                <button
                  type="button"
                  onClick={() => onPoser(texte)}
                  className="cible-tactile w-full rounded-md border bg-card px-3 py-2.5 text-start text-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {texte}
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

