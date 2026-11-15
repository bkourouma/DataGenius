import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { toIntlTag } from '@/i18n/config'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { chargerVersion, optionsTableau } from '@/lib/warehouse/tableaux'
import { RestaurerVersion } from '../restaurer-version'

const FORMAT_VERSION = /^[1-9]\d{0,8}$/

export async function generateMetadata({ params }: { params: { version: string } }): Promise<Metadata> {
  const t = await getTranslations('historique')
  if (!FORMAT_VERSION.test(params.version)) return { title: t('titre') }
  return { title: t('apercuTitre', { n: params.version }) }
}

export default async function ApercuVersionPage({ params }: { params: { id: string; version: string } }) {
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  if (!FORMAT_VERSION.test(params.version)) notFound()
  const numero = Number(params.version)
  const version = await chargerVersion(acces.contexte, params.id, numero)
  if (!version) notFound()
  const t = await getTranslations('historique')
  const locale = await getLocale()
  const date = new Intl.DateTimeFormat(toIntlTag(locale), { dateStyle: 'long', timeStyle: 'short' }).format(version.datee)
  const { definition, resume: r } = version
  const options = definition ? await optionsTableau(acces.contexte) : []

  const changements: string[] = []
  if (r === null) changements.push(t('resumeIndisponible'))
  else {
    if (r.ajoutees > 0) changements.push(t('resumeAjoutees', { n: r.ajoutees }))
    if (r.retirees > 0) changements.push(t('resumeRetirees', { n: r.retirees }))
    if (r.modifiees > 0) changements.push(t('resumeModifiees', { n: r.modifiees }))
    if (r.titreModifie) changements.push(t('resumeTitre'))
    if (r.lecteursModifies) changements.push(t('resumeLecteurs'))
    if (!changements.length) changements.push(numero === 1 ? t('resumeInitiale') : t('resumeAucun'))
  }

  return <section className="mx-auto max-w-3xl space-y-5">
    <EnTetePage
      retour={{ href: `/tableaux/${params.id}/historique`, libelle: t('retourHistorique') }}
      titre={t('apercuTitre', { n: numero })}
      description={t('apercuDescription')} />
    <dl className="grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">{t('labelDate')}</dt><dd>{date}</dd></div>
      <div><dt className="text-muted-foreground">{t('labelAuteur')}</dt><dd>{version.auteur}</dd></div>
      <div className="sm:col-span-2">
        <dt className="text-muted-foreground">{t('labelChangements')}</dt>
        <dd><ul className="list-disc ps-5">{changements.map(c => <li key={c}>{c}</li>)}</ul></dd>
      </div>
      {version.courante && <div className="sm:col-span-2"><dd className="font-semibold text-primary">{t('actuelle')}</dd></div>}
    </dl>

    {definition === null
      ? <p role="status" className="rounded-lg border bg-card p-4 text-sm">{t('incompatible')}</p>
      : <>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t('labelTitre')}</p>
          <p className="font-semibold">{definition.titre}</p>
        </div>
        <section aria-labelledby="titre-tuiles" className="space-y-3">
          <h2 id="titre-tuiles" className="text-lg font-semibold">{t('labelTuiles')}</h2>
          {!definition.tuiles.length && <p className="text-muted-foreground">{t('aucuneTuile')}</p>}
          <ol className="space-y-3">
            {definition.tuiles.map((tuile, index) => {
              if (tuile.type === 'artefact') return <li key={tuile.id} className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t('tuileNumero', { n: index + 1 })}</p>
                <p className="font-semibold">{t('artefact')}</p>
              </li>
              const jeu = options.find(o => o.cle === tuile.jeu)
              const mesure = jeu?.mesures.find(m => m.cle === tuile.mesure)
              const dimensions = tuile.dimensions.map(cle => jeu?.dimensions.find(d => d.cle === cle)?.libelle ?? t('inexistant', { cle }))
              return <li key={tuile.id} className="space-y-2 rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t('tuileNumero', { n: index + 1 })}</p>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">{t('labelJeu')}</dt><dd>{jeu?.libelle ?? t('inexistant', { cle: tuile.jeu })}</dd></div>
                  <div><dt className="text-muted-foreground">{t('labelMesure')}</dt><dd>{mesure?.libelle ?? t('inexistant', { cle: tuile.mesure })}</dd></div>
                  {dimensions.length > 0 && <div><dt className="text-muted-foreground">{t('labelDimensions')}</dt><dd>{dimensions.join(', ')}</dd></div>}
                  {tuile.objectif !== undefined && <div><dt className="text-muted-foreground">{t('labelObjectif')}</dt><dd>{tuile.objectif}</dd></div>}
                  {tuile.alerte && <div><dt className="text-muted-foreground">{t('labelAlerte')}</dt>
                    <dd>{t(tuile.alerte.sens === 'au_dessus' ? 'alerteAuDessus' : 'alerteAuDessous', { seuil: tuile.alerte.seuil })}</dd></div>}
                </dl>
              </li>
            })}
          </ol>
        </section>
        <p className="text-sm text-muted-foreground">{t('lecteursNonAffiches')}</p>
        {!version.courante && <details className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">{t('restaurerCetteVersion')}</summary>
          <RestaurerVersion id={params.id} version={numero} versionCourante={version.versionCourante} />
        </details>}
      </>}
  </section>
}
