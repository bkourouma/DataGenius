import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { etatEntrepot } from '@/lib/warehouse/synchronisation'
import Link from 'next/link'
import { listerCombinaisons } from '@/lib/warehouse/combinaisons-admin'
import { listerSources } from '@/lib/warehouse/sources-admin'
import { FormulaireConnexion, FormulaireFrequence, Soumettre } from './formulaires'
import { actualiserJeu } from './actions'

export const dynamic = 'force-dynamic'

const date = new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })

export default async function Sources() {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) redirect('/medic-assist')
  const [jeux, sources, combinaisons] = await Promise.all([
    etatEntrepot().catch(() => null), listerSources().catch(() => null),
    listerCombinaisons().catch(() => null),
  ])

  return (
    <section className="mx-auto max-w-3xl space-y-5 py-6">
      <h1 className="text-2xl font-bold">Sources et synchronisation</h1>
      <Link href="/sources/droits" className="inline-flex text-sm font-medium text-primary hover:underline">Groupes et droits d’accès aux données</Link>
      <details className="rounded-lg border bg-card p-5">
        <summary className="cursor-pointer font-semibold">Ajouter une base PostgreSQL</summary>
        <div className="mt-4"><FormulaireConnexion /></div>
      </details>
      {!!sources?.length && (
        <section className="space-y-2">
          <h2 className="font-semibold">Bases connectées</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {sources.map(source => (
              <li key={source.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div><p className="font-medium">{source.titre}</p><p className="text-sm text-muted-foreground">{source.hote} · {source.base}</p></div>
                <Link className="text-sm text-primary hover:underline" href={'/sources/' + source.id} prefetch={false}>Explorer les tables<span className="sr-only"> de {source.titre}</span></Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section id="combinaisons" className="space-y-3 scroll-mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Jeux combinés</h2>
          <Link href="/sources/combiner" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Combiner des jeux</Link>
        </div>
        {combinaisons === null && <p role="status" className="text-sm">Les jeux combinés sont momentanément indisponibles.</p>}
        {!!combinaisons?.length && (
          <ul className="divide-y rounded-lg border bg-card">
            {combinaisons.map(jeu => (
              <li key={jeu.cle} className="space-y-1 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{jeu.titre}</h3>
                  <div className="flex flex-wrap gap-3">
                    <Link href={'/sources/combiner/' + jeu.cle} className="text-sm text-primary hover:underline" prefetch={false}>
                      Modifier<span className="sr-only"> {jeu.titre}</span>
                    </Link>
                    {jeu.disponible && <LienCatalogue cle={jeu.cle} titre={jeu.titre} />}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{jeu.gauche} + {jeu.droite}</p>
                <p className="text-sm text-muted-foreground">
                  {jeu.type === 'gauche' ? 'Toutes les lignes du premier jeu' : 'Lignes correspondantes'}
                  {' · ' + jeu.liens + ' liaison(s) · ' + jeu.colonnes + ' colonne(s)'}
                </p>
                {!jeu.disponible && <p className="text-sm text-destructive">Un jeu ou une colonne de la combinaison est indisponible.</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <h2 className="font-semibold">Imports et publications</h2>
      {(jeux === null || sources === null) && <p role="status">Entrepôt indisponible. Vérifiez la configuration et les migrations.</p>}
      {jeux?.length === 0 && <p role="status">Ajoutez une base, puis ouvrez une table pour configurer un import.</p>}
      <ul className="space-y-3">
        {jeux?.map(({ cle, titre, source, frequence, modifiable, etat }) => (
          <li key={cle} className="space-y-3 rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{titre}</h2>
              {modifiable && <div className="flex flex-wrap gap-3">
                <LienCatalogue cle={cle} titre={titre} />
                <Link href={'/sources/qualite/' + cle} className="text-sm text-primary hover:underline" prefetch={false}>
                  Qualité et suivi<span className="sr-only"> de {titre}</span>
                </Link>
              </div>}
            </div>
            <p className="text-sm text-muted-foreground">{source} · Toutes les {frequence} min</p>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt>Dernière publication</dt><dd>{etat?.publie_a ? date.format(etat.publie_a) + ' UTC' : 'En attente du premier import'}</dd></div>
              <div><dt>Lignes publiées</dt><dd>{etat?.lignes ?? '—'}</dd></div>
              <div><dt>Dernière vérification</dt><dd>{etat?.verifie_a ? date.format(etat.verifie_a) + ' UTC' : '—'}</dd></div>
              <div><dt>Résultat</dt><dd>{etat?.statut === 'echec' ? 'Échec de synchronisation' :
                etat?.statut === 'identique' ? 'Données identiques' : etat?.statut === 'publie' ? 'Copie publiée' : '—'}</dd></div>
            </dl>
            {modifiable && <FormulaireFrequence cle={cle} frequence={frequence} />}
            <form action={actualiserJeu}>
              <input type="hidden" name="jeu" value={cle} />
              <Soumettre texte={'Synchroniser ' + titre} attente="Synchronisation en cours…" variant="outline" />
            </form>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LienCatalogue({ cle, titre }: { cle: string; titre: string }) {
  return <Link href={'/sources/catalogue/' + cle} className="text-sm text-primary hover:underline" prefetch={false}>
    Catalogue métier<span className="sr-only"> de {titre}</span>
  </Link>
}
