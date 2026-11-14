import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { chargerQualite } from '@/lib/warehouse/qualite-admin'
import { messagesExecution } from '@/lib/warehouse/qualite'
import { FormulaireQualite, RelancerImport } from './formulaire'

export const dynamic = 'force-dynamic'

const formatDate = new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
const statuts = { publie: 'Copie publiée', identique: 'Copie inchangée', echec: 'Échec' }

export default async function QualiteImport({ params, searchParams }: {
  params: { cle: string }; searchParams: { etat?: string }
}) {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/assistant')
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(params.cle)) notFound()
  const jeu = await chargerQualite(params.cle)
  if (!jeu) notFound()
  const enRetard = jeu.derniereReussite && Date.now() - jeu.derniereReussite.getTime() > jeu.frequenceMinutes * 60_000
  const date = (valeur: Date | null) => valeur ? formatDate.format(valeur) + ' UTC' : '—'

  return (
    <section className="mx-auto max-w-4xl space-y-5 py-6">
      <Link href="/sources" className="text-sm text-primary hover:underline">Sources</Link>
      <h1 className="text-2xl font-bold">Qualité et suivi · {jeu.titre}</h1>
      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="font-semibold">Fraîcheur des données</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt>Dernière publication</dt><dd>{date(jeu.publication)}</dd></div>
          <div><dt>Dernière vérification réussie</dt><dd>{date(jeu.derniereReussite)}</dd></div>
          <div><dt>Fréquence</dt><dd>Toutes les {jeu.frequenceMinutes} min</dd></div>
          <div><dt>État</dt><dd>{jeu.historique[0]?.statut === 'echec' ? 'Dernière synchronisation en échec' :
            !jeu.derniereReussite ? 'En attente de vérification' : enRetard ? 'Vérification en retard' : 'À jour'}</dd></div>
        </dl>
        <RelancerImport cle={jeu.cle} />
        {jeu.incrementalPossible && <Link href={'/sources/incremental/' + jeu.cle}
          className="inline-block text-sm text-primary hover:underline">Configurer la synchronisation incrémentale</Link>}
      </section>
      {searchParams.etat === 'enregistre' && <p role="status" className="text-sm">Configuration enregistrée. Les règles seront appliquées à la prochaine synchronisation.</p>}
      <FormulaireQualite key={jeu.version} jeu={jeu} />
      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="font-semibold">Dernières synchronisations</h2>
        {jeu.historique.length === 0 ? <p className="text-sm text-muted-foreground">Aucune synchronisation enregistrée.</p> : (
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead><tr><th scope="col">Date</th><th scope="col">Mode</th><th scope="col">Résultat</th><th scope="col">Lues</th><th scope="col">Retenues</th></tr></thead>
              <tbody className="divide-y">
                {jeu.historique.map((ligne, index) => <tr key={index}>
                  <td className="py-2">{date(ligne.verifieA)}</td>
                  <td>{ligne.modeLecture === 'delta' ? 'Modifications' : ligne.modeLecture === 'reconciliation' ? 'Réconciliation' : '—'}</td>
                  <td>{statuts[ligne.statut]}{ligne.code && messagesExecution[ligne.code] ? ' · ' + messagesExecution[ligne.code] : ''}</td>
                  <td>{ligne.lignesLues ?? '—'}</td><td>{ligne.lignesValides ?? '—'}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="space-y-2 rounded-lg border bg-card p-5">
        <h2 className="font-semibold">Jeux dépendants</h2>
        {jeu.dependances.length ? <ul className="list-disc pl-5 text-sm">{jeu.dependances.map(d => <li key={d.cle}>{d.titre}</li>)}</ul> :
          <p className="text-sm text-muted-foreground">Aucun jeu dépendant identifié.</p>}
      </section>
    </section>
  )
}
