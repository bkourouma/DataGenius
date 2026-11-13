import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { notFound, redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { chargerQualite } from '@/lib/warehouse/qualite-admin'
import { messagesExecution } from '@/lib/warehouse/qualite'
import { Badge } from '@/components/ui/badge'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { FormulaireQualite, RelancerImport } from './formulaire'

export const dynamic = 'force-dynamic'

const formatDate = new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
const variantesStatut = { publie: 'success', identique: 'success', echec: 'danger' } as const
const statuts = { publie: 'Copie publiée', identique: 'Copie inchangée', echec: 'Échec' }

export default async function QualiteImport({ params, searchParams }: {
  params: { cle: string }; searchParams: { etat?: string }
}) {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/medic-assist')
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(params.cle)) notFound()
  const jeu = await chargerQualite(params.cle)
  if (!jeu) notFound()
  const enRetard = jeu.derniereReussite && Date.now() - jeu.derniereReussite.getTime() > jeu.frequenceMinutes * 60_000
  const date = (valeur: Date | null) => valeur ? formatDate.format(valeur) + ' UTC' : '—'

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <EnTetePage
        retour={{ href: '/sources', libelle: 'Sources' }}
        titre={'Qualité et suivi · ' + jeu.titre}
        description="Fraîcheur des données, règles de contrôle et historique des synchronisations."
      />
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="text-base font-semibold">Fraîcheur des données</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Dernière publication</dt><dd>{date(jeu.publication)}</dd></div>
          <div><dt className="text-muted-foreground">Dernière vérification réussie</dt><dd>{date(jeu.derniereReussite)}</dd></div>
          <div><dt className="text-muted-foreground">Fréquence</dt><dd>Toutes les {jeu.frequenceMinutes} min</dd></div>
          <div><dt className="text-muted-foreground">État</dt><dd className="mt-0.5">{jeu.historique[0]?.statut === 'echec' ? <Badge variant="danger">Dernière synchronisation en échec</Badge> :
            !jeu.derniereReussite ? <Badge variant="outline">En attente de vérification</Badge> : enRetard ? <Badge variant="warning">Vérification en retard</Badge> : <Badge variant="success">À jour</Badge>}</dd></div>
        </dl>
        <RelancerImport cle={jeu.cle} />
        {jeu.incrementalPossible && <Link href={'/sources/incremental/' + jeu.cle}
          className="block text-sm text-primary hover:underline">Configurer la synchronisation incrémentale</Link>}
      </section>
      {searchParams.etat === 'enregistre' && (
        <p role="status" className="flex items-center gap-2 rounded-md bg-success-soft p-3 text-sm text-success">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />Configuration enregistrée. Les règles seront appliquées à la prochaine synchronisation.
        </p>
      )}
      <FormulaireQualite key={jeu.version} jeu={jeu} />
      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="text-base font-semibold">Dernières synchronisations</h2>
        {jeu.historique.length === 0 ? <p className="text-sm text-muted-foreground">Aucune synchronisation enregistrée.</p> : (
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-muted-foreground"><tr><th scope="col" className="py-2 pe-3 font-medium">Date</th><th scope="col" className="pe-3 font-medium">Mode</th><th scope="col" className="pe-3 font-medium">Résultat</th><th scope="col" className="pe-3 text-end font-medium">Lues</th><th scope="col" className="text-end font-medium">Retenues</th></tr></thead>
              <tbody className="divide-y">
                {jeu.historique.map((ligne, index) => <tr key={index}>
                  <td className="py-2 pe-3">{date(ligne.verifieA)}</td>
                  <td className="pe-3">{ligne.modeLecture === 'delta' ? 'Modifications' : ligne.modeLecture === 'reconciliation' ? 'Réconciliation' : '—'}</td>
                  <td className="pe-3"><Badge variant={variantesStatut[ligne.statut]}>{statuts[ligne.statut]}</Badge>{ligne.code && messagesExecution[ligne.code] ? <span className="ms-2 text-muted-foreground">{messagesExecution[ligne.code]}</span> : null}</td>
                  <td className="pe-3 text-end">{ligne.lignesLues ?? '—'}</td><td className="text-end">{ligne.lignesValides ?? '—'}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="space-y-2 rounded-lg border bg-card p-5">
        <h2 className="text-base font-semibold">Jeux dépendants</h2>
        {jeu.dependances.length ? <ul className="list-disc pl-5 text-sm">{jeu.dependances.map(d => <li key={d.cle}>{d.titre}</li>)}</ul> :
          <p className="text-sm text-muted-foreground">Aucun jeu dépendant identifié.</p>}
      </section>
    </section>
  )
}
