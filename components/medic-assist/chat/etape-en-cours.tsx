'use client'

import { useTranslations } from 'next-intl'
import { CLES_JEUX, NOMS_OUTILS } from '@/lib/medic-assist/contrats/constantes'

const OUTILS_CONNUS: readonly string[] = NOMS_OUTILS
const JEUX_CONNUS: readonly string[] = CLES_JEUX

/** Ligne sobre : trois points animes (fixes sous `motion-reduce`) et un libelle. */
export function LigneEtape({ libelle }: { libelle: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="my-2 flex items-center gap-2 text-sm text-muted-foreground"
    >
      <span className="flex items-center gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-pulse rounded-md bg-muted-foreground/60 motion-reduce:animate-none"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
      <span>{libelle}</span>
    </div>
  )
}

/** Etape d'un outil en cours (`input-streaming` / `input-available`). */
export function EtapeEnCours({ nom, input }: { nom: string; input?: unknown }) {
  const t = useTranslations('medicAssist.outils')
  // Cles dynamiques : jeu et nom sont verifies contre CLES_JEUX / NOMS_OUTILS juste avant.
  let libelle: string
  if (nom === 'interroger_donnees') {
    const jeu = (input as { jeu?: unknown } | null | undefined)?.jeu
    libelle =
      typeof jeu === 'string' && JEUX_CONNUS.includes(jeu)
        ? t('etapes.interroger_donnees', { jeu: t(`jeux.${jeu}` as Parameters<typeof t>[0]) })
        : t('etapes.interroger_donnees_sans_jeu')
  } else if (OUTILS_CONNUS.includes(nom)) {
    libelle = t(`etapes.${nom}` as Parameters<typeof t>[0])
  } else {
    libelle = t('etapes.autre')
  }
  return <LigneEtape libelle={libelle} />
}

/** « Reflechit… » (rien recu) ou « Redige la reponse… » (flux ouvert, rien d'affichable). */
export function IndicateurAttente({ variante }: { variante: 'reflexion' | 'redaction' }) {
  const t = useTranslations('medicAssist.fil')
  return <LigneEtape libelle={t(variante)} />
}
