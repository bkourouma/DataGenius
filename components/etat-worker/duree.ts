import { toIntlTag } from '@/i18n/config'

const SECONDE_MS = 1000
const MINUTE_MS = 60 * SECONDE_MS
const HEURE_MS = 60 * MINUTE_MS
const JOUR_MS = 24 * HEURE_MS

// Durée lisible dans la langue courante (« 12 minutes », « 3 hours »), arrondie à l'entier inférieur.
export function formaterDuree(ms: number, locale: string): string {
  const brut = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const [unit, diviseur] =
    brut < MINUTE_MS ? (['second', SECONDE_MS] as const)
    : brut < HEURE_MS ? (['minute', MINUTE_MS] as const)
    : brut < JOUR_MS ? (['hour', HEURE_MS] as const)
    : (['day', JOUR_MS] as const)
  return new Intl.NumberFormat(toIntlTag(locale), { style: 'unit', unit, unitDisplay: 'long' })
    .format(Math.floor(brut / diviseur))
}
