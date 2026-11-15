import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { journal } from '@/lib/journal'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { lireEtatWorker, type EtatWorker } from '@/lib/warehouse/etat-worker'
import { formaterDuree } from './duree'
import { PastilleEtatWorker } from './pastille-etat-worker'

// Réservé aux administrateurs ; ne casse jamais la page qui l'accueille.
export async function BandeauEtatWorker() {
  if (!(await exigerAdminMedicAssist()).ok) return null
  let etat: EtatWorker
  try {
    etat = await lireEtatWorker()
  } catch (erreur) {
    journal.avertissement('Bandeau du worker : lecture impossible', {
      code: 'etat_worker_illisible', erreur: erreur instanceof Error ? erreur.name : typeof erreur,
    })
    return null
  }
  const t = await getTranslations('etatWorker')
  const locale = await getLocale()
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">{t('bandeau.titre')}</span>
        <PastilleEtatWorker statut={etat.statut} />
        <Link href="/sources/worker" className="font-medium text-primary hover:underline">
          {t('bandeau.ouvrir')}
        </Link>
      </div>
      {etat.statut === 'jamais_vu' && (
        <p className="text-sm text-muted-foreground">{t('bandeau.jamaisVuAide')}</p>
      )}
      {etat.statut === 'arrete' && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{t('bandeau.alerte', { duree: formaterDuree(etat.silenceMs ?? 0, locale) })}</p>
            <Link href="/sources/worker" className="mt-1 inline-block font-medium underline">
              {t('bandeau.detail')}
            </Link>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
