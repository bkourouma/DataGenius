import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { TrendingUp } from 'lucide-react'
import { EnTetePage, EtatVide } from '@/components/ui/en-tete-page'
import { toIntlTag } from '@/i18n/config'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { analyserTendance, bornesTendances, ErreurTendances, optionsTendances } from '@/lib/warehouse/tendances'
import { FormulaireTendances } from './formulaire'

export const dynamic = 'force-dynamic'

type Parametres = Record<string, string | string[] | undefined>
const cellule = 'px-3 py-2 text-start'

export default async function TendancesPage({ searchParams }: { searchParams: Parametres }) {
  const t = await getTranslations('ecrans.tendances')
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const { contexte } = acces
  const bornes = bornesTendances(contexte)
  const lire = (cle: string) => {
    const valeur = searchParams[cle]
    return typeof valeur === 'string' ? valeur : undefined
  }
  const selection = {
    jeu: lire('jeu'), mesure: lire('mesure'), debut: lire('debut') ?? bornes.debut,
    fin: lire('fin') ?? bornes.fin, horizon: lire('horizon') ?? '3',
  }
  const options = await optionsTendances(contexte)
  let resultat: Awaited<ReturnType<typeof analyserTendance>> | undefined
  let erreur: string | undefined
  if (selection.jeu && selection.mesure) {
    try {
      resultat = await analyserTendance({ ...selection, horizon: Number(selection.horizon) }, contexte)
    } catch (cause) {
      erreur = cause instanceof ErreurTendances ? cause.message : t('indisponible')
    }
  }
  const analyse = resultat?.analyse
  const format = new Intl.NumberFormat(toIntlTag(contexte.locale), { maximumFractionDigits: 4 })
  const entier = new Intl.NumberFormat(toIntlTag(contexte.locale))
  const compte = (count: number) => ({ count, n: entier.format(count) })
  const valeur = (nombre: number | string | null) =>
    typeof nombre === 'number' ? format.format(nombre) : nombre ?? '—'
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <EnTetePage titre={t('titre')} description={t('description')} />
      {options.length ? <FormulaireTendances options={options} selection={selection} />
        : <EtatVide icone={<TrendingUp />} titre={t('aucunTitre')}>{t('aucunDescription')}</EtatVide>}
      {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
      {resultat && analyse && <>
        <h2 className="text-xl font-semibold">{resultat.mesure}{resultat.unite ? ' · ' + resultat.unite : ''}</h2>
        <section className="space-y-2" aria-labelledby="observations">
          <h3 id="observations" className="font-semibold">{t('observations')}</h3>
          <p className="text-sm text-muted-foreground">{t('observationsAide')}</p>
          {analyse.manquants > 0 && <p className="text-sm">{t('manquants', compte(analyse.manquants))}</p>}
          {analyse.valeursHorsPrecision > 0 && <p className="text-sm">{t('horsPrecision', compte(analyse.valeursHorsPrecision))}</p>}
          <div className="max-h-80 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted"><tr><th className={cellule} scope="col">{t('mois')}</th><th className={cellule} scope="col">{t('valeur')}</th><th className={cellule} scope="col">{t('ecart')}</th></tr></thead>
              <tbody className="divide-y">{analyse.observations.map(point => <tr key={point.mois}>
                <th className={cellule + ' font-normal'} scope="row">{point.mois}</th>
                <td className={cellule}>{valeur(point.valeur)}</td>
                <td className={cellule}>{point.atypique ? t('atypique') : '—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>
        <section className="space-y-2" aria-labelledby="previsions">
          <h3 id="previsions" className="font-semibold">{t('previsions')}</h3>
          <p className="text-sm text-muted-foreground">{t('previsionsAide')}</p>
          {analyse.validation && <p className="text-sm">{t('validation', { ...compte(analyse.validation.points), mae: valeur(analyse.validation.mae) })}</p>}
          {analyse.previsions.length ? <div className="overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted"><tr><th className={cellule} scope="col">{t('mois')}</th><th className={cellule} scope="col">{t('estimation')}</th><th className={cellule} scope="col">{t('bande')}</th></tr></thead>
              <tbody className="divide-y">{analyse.previsions.map(point => <tr key={point.mois}>
                <th className={cellule + ' font-normal'} scope="row">{point.mois}</th>
                <td className={cellule}>{valeur(point.valeur)}</td>
                <td className={cellule}>{point.bas === null || point.haut === null ? '—' : t('bandeValeurs', { bas: valeur(point.bas), haut: valeur(point.haut) })}</td>
              </tr>)}</tbody>
            </table>
          </div> : <p className="text-sm">{t('serieInsuffisante', compte(analyse.dernieresObservations))}</p>}
        </section>
        <section className="space-y-2 text-sm" aria-labelledby="provenance">
          <h3 id="provenance" className="font-semibold">{t('provenance')}</h3>
          <p>{resultat.provenance.libelleSource ?? resultat.jeu}{resultat.provenance.periode ? ' · ' + resultat.provenance.periode.libelle : ''}</p>
          <ul className="list-disc space-y-1 ps-5">{resultat.provenance.regles.map((regle, index) => <li key={index}>{regle}</li>)}</ul>
        </section>
      </>}
    </section>
  )
}
