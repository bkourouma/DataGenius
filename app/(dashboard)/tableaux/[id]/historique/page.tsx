import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { toIntlTag } from '@/i18n/config'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { listerVersions } from '@/lib/warehouse/tableaux'
import { VERSIONS_CONSERVEES } from '@/lib/warehouse/tableaux-historique'
import { RestaurerVersion } from './restaurer-version'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('historique')
  return { title: t('titre') }
}

export default async function HistoriquePage({ params }: { params: { id: string } }) {
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const historique = await listerVersions(acces.contexte, params.id)
  if (!historique) notFound()
  const t = await getTranslations('historique')
  const locale = await getLocale()
  const format = new Intl.DateTimeFormat(toIntlTag(locale), { dateStyle: 'medium', timeStyle: 'short' })
  const versions = historique.versions.slice(0, VERSIONS_CONSERVEES)

  return <section className="mx-auto max-w-5xl space-y-5">
    <EnTetePage retour={{ href: `/tableaux/${params.id}`, libelle: t('retourTableau') }} titre={t('titre')} description={t('description')} />
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-start text-sm">
        <caption className="sr-only">{t('legende')}</caption>
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" className="border-b p-3 text-start font-medium">{t('colVersion')}</th>
            <th scope="col" className="border-b p-3 text-start font-medium">{t('colDate')}</th>
            <th scope="col" className="border-b p-3 text-start font-medium">{t('colAuteur')}</th>
            <th scope="col" className="border-b p-3 text-start font-medium">{t('colChangements')}</th>
            <th scope="col" className="border-b p-3 text-start font-medium">{t('colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {versions.map(v => {
            const r = v.resume
            const lignes: string[] = []
            if (r === null) lignes.push(t('resumeIndisponible'))
            else {
              if (r.ajoutees > 0) lignes.push(t('resumeAjoutees', { n: r.ajoutees }))
              if (r.retirees > 0) lignes.push(t('resumeRetirees', { n: r.retirees }))
              if (r.modifiees > 0) lignes.push(t('resumeModifiees', { n: r.modifiees }))
              if (r.titreModifie) lignes.push(t('resumeTitre'))
              if (r.lecteursModifies) lignes.push(t('resumeLecteurs'))
              if (!lignes.length) lignes.push(v.version === 1 ? t('resumeInitiale') : t('resumeAucun'))
            }
            return <tr key={v.version} className="align-top">
              <th scope="row" className="border-b p-3 text-start font-medium tabular-nums">
                {t('versionNumero', { n: v.version })}
                {v.courante && <span className="ms-2 inline-block rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{t('actuelle')}</span>}
              </th>
              <td className="border-b p-3">{format.format(v.datee)}</td>
              <td className="border-b p-3">{v.auteur}</td>
              <td className="border-b p-3"><ul className="space-y-0.5">{lignes.map(l => <li key={l}>{l}</li>)}</ul></td>
              <td className="border-b p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/tableaux/${params.id}/historique/${v.version}`} aria-label={t('apercuNom', { n: v.version })}>{t('apercu')}</Link>
                  </Button>
                  {!v.courante && <details className="rounded-md border p-2">
                    <summary className="cursor-pointer text-sm">{t('restaurer')}<span className="sr-only"> {t('versionNumero', { n: v.version })}</span></summary>
                    <RestaurerVersion id={params.id} version={v.version} versionCourante={historique.courante} />
                  </details>}
                </div>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
    <p className="text-sm text-muted-foreground">{t('limite')}</p>
  </section>
}
