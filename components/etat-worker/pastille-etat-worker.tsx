import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import type { EtatWorker } from '@/lib/warehouse/etat-worker'

const variantes = {
  marche: 'success',
  en_retard: 'warning',
  arrete: 'danger',
  jamais_vu: 'outline',
} as const

const cles = {
  marche: 'marche',
  en_retard: 'enRetard',
  arrete: 'arrete',
  jamais_vu: 'jamaisVu',
} as const

// Le texte est toujours présent : l'état ne repose jamais sur la couleur seule.
export function PastilleEtatWorker({ statut }: { statut: EtatWorker['statut'] }) {
  const t = useTranslations('etatWorker')
  return <Badge variant={variantes[statut]}>{t(`statut.${cles[statut]}`)}</Badge>
}
