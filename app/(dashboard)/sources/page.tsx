import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { etatEntrepot } from '@/lib/warehouse/synchronisation'
import Link from 'next/link'
import { Combine, Database, FileSpreadsheet, Globe, Server, ShieldCheck } from 'lucide-react'
import { listerCombinaisons } from '@/lib/warehouse/combinaisons-admin'
import { listerSources } from '@/lib/warehouse/sources-admin'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { EnTetePage, EtatVide } from '@/components/ui/en-tete-page'
import { Soumettre } from './formulaires'
import { BoutonAjouterSource } from './ajouter-source'
import { FrequenceDialogue } from './frequence-dialogue'
import { actualiserJeu } from './actions'

export const dynamic = 'force-dynamic'

const typeSource = { postgresql: 'PostgreSQL', mysql: 'MySQL', rest: 'API REST', fichier: 'Fichier' }
const icones = { postgresql: Database, mysql: Server, rest: Globe, fichier: FileSpreadsheet }
const date = new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
const nombre = new Intl.NumberFormat('fr')
const lienDiscret = 'text-sm font-medium text-primary hover:underline'

export default async function Sources() {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) redirect('/medic-assist')
  const [jeux, sources, combinaisons] = await Promise.all([
    etatEntrepot().catch(() => null), listerSources().catch(() => null),
    listerCombinaisons().catch(() => null),
  ])

  return (
    <section className="mx-auto max-w-4xl space-y-8">
      <EnTetePage
        titre="Sources et synchronisation"
        description="Connectez vos bases, API et fichiers, puis suivez la publication de chaque jeu de données."
        actions={<>
          <Link href="/sources/droits" className={buttonVariants({ variant: 'outline' })}>
            <ShieldCheck className="size-4" aria-hidden />Droits d’accès
          </Link>
          <BoutonAjouterSource />
        </>}
      />

      {/* Sans aucune source, l'etat vide « Aucune source connectee » suffit a guider. */}
      {sources?.length !== 0 && <section aria-labelledby="titre-imports" className="space-y-3">
        <h2 id="titre-imports" className="text-lg font-semibold">Imports et publications</h2>
        {(jeux === null || sources === null) && <p role="status" className="text-sm">Entrepôt indisponible. Vérifiez la configuration et les migrations.</p>}
        {jeux?.length === 0 && <p role="status" className="text-sm">Ajoutez une source, puis ouvrez ses données pour configurer un import.</p>}
        <ul className="space-y-3">
          {jeux?.map(({ cle, titre, source, frequence, modifiable, etat }) => (
            <li key={cle} className="space-y-4 rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <h3 className="font-semibold">{titre}</h3>
                  <p className="text-sm text-muted-foreground"><span className="font-mono text-xs">{source}</span> · Toutes les {frequence} min</p>
                </div>
                {etat?.statut === 'echec' ? <Badge variant="danger">Échec de synchronisation</Badge>
                  : etat?.statut === 'publie' ? <Badge variant="success">Publié</Badge>
                  : etat?.statut === 'identique' ? <Badge variant="success">À jour</Badge>
                  : <Badge variant="warning">En attente du premier import</Badge>}
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-muted-foreground">Dernière publication</dt><dd className="font-medium">{etat?.publie_a ? date.format(etat.publie_a) + ' UTC' : 'En attente du premier import'}</dd></div>
                <div><dt className="text-muted-foreground">Lignes publiées</dt><dd className="font-medium tabular-nums">{etat?.lignes == null ? '—' : nombre.format(Number(etat.lignes))}</dd></div>
                <div><dt className="text-muted-foreground">Dernière vérification</dt><dd className="font-medium">{etat?.verifie_a ? date.format(etat.verifie_a) + ' UTC' : '—'}</dd></div>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <form action={actualiserJeu}>
                  <input type="hidden" name="jeu" value={cle} />
                  <Soumettre texte={'Synchroniser ' + titre} attente="Synchronisation en cours…" variant="outline" />
                </form>
                {modifiable && <div className="flex flex-wrap items-center gap-3">
                  <FrequenceDialogue cle={cle} titre={titre} frequence={frequence} />
                  <LienCatalogue cle={cle} titre={titre} />
                  <Link href={'/sources/qualite/' + cle} className={lienDiscret} prefetch={false}>
                    Qualité et suivi<span className="sr-only"> de {titre}</span>
                  </Link>
                </div>}
              </div>
            </li>
          ))}
        </ul>
      </section>}

      <section aria-labelledby="titre-sources" className="space-y-3">
        <h2 id="titre-sources" className="text-lg font-semibold">Sources connectées</h2>
        {sources?.length ? (
          <ul className="divide-y rounded-lg border bg-card">
            {sources.map(source => {
              const Icone = icones[source.type]
              return (
                <li key={source.id} className="flex flex-wrap items-center gap-3 p-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground" aria-hidden><Icone className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{source.titre}</p>
                    <p className="truncate text-sm text-muted-foreground">{typeSource[source.type]} · <span className="font-mono text-xs">{source.type === 'fichier' ? source.base : source.hote}</span></p>
                  </div>
                  <Link className={lienDiscret} href={'/sources/' + source.id} prefetch={false}>
                    Explorer<span className="sr-only"> {source.type === 'fichier' ? 'les feuilles' : source.type === 'rest' ? 'les données' : 'les tables'} de {source.titre}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : sources === null ? null : (
          <EtatVide icone={<Database />} titre="Aucune source connectée"
            action={<BoutonAjouterSource variant="outline" />}>
            Ajoutez une base, une API ou un fichier pour alimenter vos jeux de données.
          </EtatVide>
        )}
      </section>

      <section id="combinaisons" aria-labelledby="titre-combinaisons" className="scroll-mt-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="titre-combinaisons" className="text-lg font-semibold">Jeux combinés</h2>
          <Link href="/sources/combiner" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Combine className="size-4" aria-hidden />Combiner des jeux
          </Link>
        </div>
        {combinaisons === null && <p role="status" className="text-sm">Les jeux combinés sont momentanément indisponibles.</p>}
        {combinaisons?.length === 0 && (
          <EtatVide icone={<Combine />} titre="Aucun jeu combiné"
            action={<Link href="/sources/combiner" className={buttonVariants({ variant: 'outline' })}>Combiner des jeux</Link>}>
            Associez deux jeux publiés pour les analyser ensemble.
          </EtatVide>
        )}
        {!!combinaisons?.length && (
          <ul className="divide-y rounded-lg border bg-card">
            {combinaisons.map(jeu => (
              <li key={jeu.cle} className="space-y-1 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{jeu.titre}</h3>
                  <div className="flex flex-wrap gap-3">
                    <Link href={'/sources/combiner/' + jeu.cle} className={lienDiscret} prefetch={false}>
                      Modifier<span className="sr-only"> {jeu.titre}</span>
                    </Link>
                    {jeu.disponible && <LienCatalogue cle={jeu.cle} titre={jeu.titre} />}
                  </div>
                </div>
                <p className="font-mono text-xs text-muted-foreground">{jeu.gauche} + {jeu.droite}</p>
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
    </section>
  )
}

function LienCatalogue({ cle, titre }: { cle: string; titre: string }) {
  return <Link href={'/sources/catalogue/' + cle} className={lienDiscret} prefetch={false}>
    Catalogue métier<span className="sr-only"> de {titre}</span>
  </Link>
}
