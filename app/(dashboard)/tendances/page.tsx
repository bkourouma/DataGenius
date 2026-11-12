import { redirect } from 'next/navigation'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { analyserTendance, bornesTendances, ErreurTendances, optionsTendances } from '@/lib/warehouse/tendances'
import { FormulaireTendances } from './formulaire'

export const dynamic = 'force-dynamic'

type Parametres = Record<string, string | string[] | undefined>
const cellule = 'px-3 py-2 text-left'

export default async function TendancesPage({ searchParams }: { searchParams: Parametres }) {
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
      erreur = cause instanceof ErreurTendances ? cause.message : 'L’analyse est temporairement indisponible.'
    }
  }
  const analyse = resultat?.analyse
  const format = new Intl.NumberFormat(contexte.locale, { maximumFractionDigits: 4 })
  const valeur = (nombre: number | string | null) =>
    typeof nombre === 'number' ? format.format(nombre) : nombre ?? '—'
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <h1 className="text-2xl font-semibold">Tendances mensuelles</h1>
      {options.length ? <FormulaireTendances options={options} selection={selection} />
        : <p className="text-muted-foreground">Aucun indicateur mensuel accessible. Configurez un calendrier sur un jeu doté d’indicateurs.</p>}
      {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
      {resultat && analyse && <>
        <h2 className="text-xl font-semibold">{resultat.mesure}{resultat.unite ? ' · ' + resultat.unite : ''}</h2>
        <section className="space-y-2" aria-labelledby="observations">
          <h3 id="observations" className="font-semibold">Observations et écarts atypiques</h3>
          <p className="text-sm text-muted-foreground">Le signal compare chaque valeur aux six mois précédents. Il apparaît au-delà de 3,5 sur le score d’écart robuste, ou dès que la valeur change si la dispersion médiane est nulle.</p>
          {analyse.manquants > 0 && <p className="text-sm">{analyse.manquants} mois sans valeur.</p>}
          {analyse.valeursHorsPrecision > 0 && <p className="text-sm">{analyse.valeursHorsPrecision} valeurs affichées sans conversion et exclues des estimations.</p>}
          <div className="max-h-80 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted"><tr><th className={cellule} scope="col">Mois</th><th className={cellule} scope="col">Valeur</th><th className={cellule} scope="col">Écart</th></tr></thead>
              <tbody className="divide-y">{analyse.observations.map(point => <tr key={point.mois}>
                <th className={cellule + ' font-normal'} scope="row">{point.mois}</th>
                <td className={cellule}>{valeur(point.valeur)}</td>
                <td className={cellule}>{point.atypique ? 'Atypique' : '—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>
        <section className="space-y-2" aria-labelledby="previsions">
          <h3 id="previsions" className="font-semibold">Prévisions</h3>
          <p className="text-sm text-muted-foreground">L’estimation reprend la médiane des trois derniers mois. À partir de douze erreurs historiques à un mois, la bande ajoute et retranche leur 90e centile autour de l’estimation.</p>
          {analyse.validation && <p className="text-sm">Erreur absolue moyenne sur {analyse.validation.points} prévisions historiques successives · {valeur(analyse.validation.mae)}</p>}
          {analyse.previsions.length ? <div className="overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted"><tr><th className={cellule} scope="col">Mois</th><th className={cellule} scope="col">Estimation</th><th className={cellule} scope="col">Bande historique</th></tr></thead>
              <tbody className="divide-y">{analyse.previsions.map(point => <tr key={point.mois}>
                <th className={cellule + ' font-normal'} scope="row">{point.mois}</th>
                <td className={cellule}>{valeur(point.valeur)}</td>
                <td className={cellule}>{point.bas === null || point.haut === null ? '—' : `${valeur(point.bas)} à ${valeur(point.haut)}`}</td>
              </tr>)}</tbody>
            </table>
          </div> : <p className="text-sm">Six mois consécutifs exploitables sont requis en fin de période. Série actuelle · {analyse.dernieresObservations} mois.</p>}
        </section>
        <section className="space-y-2 text-sm" aria-labelledby="provenance">
          <h3 id="provenance" className="font-semibold">Provenance</h3>
          <p>{resultat.provenance.libelleSource ?? resultat.jeu}{resultat.provenance.periode ? ' · ' + resultat.provenance.periode.libelle : ''}</p>
          <ul className="list-disc space-y-1 pl-5">{resultat.provenance.regles.map((regle, index) => <li key={index}>{regle}</li>)}</ul>
        </section>
      </>}
    </section>
  )
}
