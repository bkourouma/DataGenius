'use client'

import { useTranslations } from 'next-intl'
import { LIMITES } from '@/lib/medic-assist/contrats/constantes'

/** Au plus 3 questions de relance non vides, a partir d'une valeur inconnue. */
export function lireQuestions(valeur: unknown): string[] {
  if (typeof valeur !== 'object' || valeur === null) return []
  const questions = (valeur as { questions?: unknown }).questions
  if (!Array.isArray(questions)) return []
  return questions
    .filter((q): q is string => typeof q === 'string' && q.trim() !== '')
    .map((q) => q.trim())
    .slice(0, LIMITES.relancesMax)
}

export function Relances({
  questions,
  onPoserQuestion,
}: {
  questions: string[]
  onPoserQuestion: (texte: string) => void
}) {
  const t = useTranslations('medicAssist.outils')
  if (questions.length === 0) return null
  return (
    <section className="mt-3" aria-label={t('relancesTitre')}>
      <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{t('relancesTitre')}</h3>
      <ul className="flex flex-wrap gap-2">
        {questions.map((question) => (
          <li key={question} className="max-w-full">
            <button
              type="button"
              onClick={() => onPoserQuestion(question)}
              aria-label={t('relanceAria', { question })}
              className="cible-tactile max-w-full rounded-md border bg-card px-3 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {question}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
