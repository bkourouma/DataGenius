import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { formaterDuree } from '@/components/etat-worker/duree'
import { PastilleEtatWorker } from '@/components/etat-worker/pastille-etat-worker'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { journal } from '@/lib/journal'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import {
  lireEtatWorker, lireExecutionsEnEchec, type EtatWorker, type ExecutionEnEchec,
} from '@/lib/warehouse/etat-worker'

export const dynamic = 'force-dynamic'

async function lire(): Promise<{ etat: EtatWorker; echecs: ExecutionEnEchec[] } | null> {
  try {
    const [etat, echecs] = await Promise.all([lireEtatWorker(), lireExecutionsEnEchec(10)])
    return { etat, echecs }
  } catch (erreur) {
    journal.avertissement('Page du worker : lecture impossible', {
      code: 'etat_worker_illisible', erreur: erreur instanceof Error ? erreur.name : typeof erreur,
    })
    return null
  }
}

export default async function PageWorker() {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/assistant')
  const [t, formateur, locale, donnees] = await Promise.all([
    getTranslations('etatWorker'), getFormatter(), getLocale(), lire(),
  ])
  const date = (valeur: Date) => formateur.dateTime(valeur, { dateStyle: 'short', timeStyle: 'short' })

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <EnTetePage
        retour={{ href: '/sources', libelle: t('page.retour') }}
        titre={t('page.titre')}
        description={t('page.description')}
      />
      {donnees === null ? (
        <p role="status" className="text-sm">{t('page.indisponible')}</p>
      ) : (
        <>
          <section aria-labelledby="titre-etat" className="space-y-4 rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="titre-etat" className="text-base font-semibold">{t('page.etat')}</h2>
              <PastilleEtatWorker statut={donnees.etat.statut} />
            </div>
            {donnees.etat.instance === null ? (
              <p className="text-sm text-muted-foreground">{t('bandeau.jamaisVuAide')}</p>
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">{t('page.silence')}</dt>
                  <dd>{formaterDuree(donnees.etat.silenceMs ?? 0, locale)}</dd></div>
                <div><dt className="text-muted-foreground">{t('page.hote')}</dt>
                  <dd className="font-mono text-xs">{donnees.etat.instance.hote}</dd></div>
                <div><dt className="text-muted-foreground">{t('page.version')}</dt>
                  <dd className="font-mono text-xs">{donnees.etat.instance.version}</dd></div>
                <div><dt className="text-muted-foreground">{t('page.demarreA')}</dt>
                  <dd>{date(donnees.etat.instance.demarreA)}</dd></div>
                <div><dt className="text-muted-foreground">{t('page.dernierSigne')}</dt>
                  <dd>{date(donnees.etat.instance.dernierSigneA)}</dd></div>
              </dl>
            )}
          </section>
          {donnees.etat.instance !== null && (
            <section aria-labelledby="titre-tour" className="space-y-3 rounded-lg border bg-card p-5">
              <h2 id="titre-tour" className="text-base font-semibold">{t('page.dernierTour')}</h2>
              {donnees.etat.instance.dernierTour === null ? (
                <p className="text-sm text-muted-foreground">{t('page.aucunTour')}</p>
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">{t('page.dateTour')}</dt>
                    <dd>{date(donnees.etat.instance.dernierTour.a)}</dd></div>
                  <div><dt className="text-muted-foreground">{t('page.duree')}</dt>
                    <dd>{formaterDuree(donnees.etat.instance.dernierTour.dureeMs, locale)}</dd></div>
                  <div><dt className="text-muted-foreground">{t('page.jeux')}</dt>
                    <dd>{formateur.number(donnees.etat.instance.dernierTour.jeux)}</dd></div>
                  <div><dt className="text-muted-foreground">{t('page.erreurs')}</dt>
                    <dd>{formateur.number(donnees.etat.instance.dernierTour.erreurs)}</dd></div>
                </dl>
              )}
            </section>
          )}
          <section aria-labelledby="titre-echecs" className="space-y-3 rounded-lg border bg-card p-5">
            <h2 id="titre-echecs" className="text-base font-semibold">{t('page.echecs')}</h2>
            {donnees.echecs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('page.aucunEchec')}</p>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-start text-sm">
                  <thead className="border-b text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-2 pe-3 text-start font-medium">{t('page.colJeu')}</th>
                      <th scope="col" className="pe-3 text-start font-medium">{t('page.colCode')}</th>
                      <th scope="col" className="pe-3 text-start font-medium">{t('page.colDate')}</th>
                      <th scope="col" className="text-start font-medium">{t('page.colDuree')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {donnees.echecs.map(ligne => (
                      <tr key={`${ligne.jeu}|${ligne.verifieA.toISOString()}|${ligne.code ?? ''}|${ligne.dureeMs}`}>
                        <td className="py-2 pe-3">{ligne.jeu}</td>
                        <td className="pe-3 font-mono text-xs">{ligne.code ?? '—'}</td>
                        <td className="pe-3">{date(ligne.verifieA)}</td>
                        <td>{formaterDuree(ligne.dureeMs, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}
