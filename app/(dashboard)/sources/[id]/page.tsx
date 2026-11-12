import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { IdSourceSchema, TableSchema, listerColonnes, listerTables, trouverSource } from '@/lib/warehouse/sources-admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FormulaireFichierSource, FormulaireImport } from '../formulaires'

export const dynamic = 'force-dynamic'

type Parametres = { q?: string; schema?: string; table?: string }

export default async function SourceDetail({ params, searchParams }: { params: { id: string }; searchParams: Parametres }) {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/medic-assist')
  if (!IdSourceSchema.safeParse(params.id).success) notFound()
  const source = await trouverSource(params.id)
  if (!source) notFound()

  const recherche = typeof searchParams.q === 'string' ? searchParams.q.slice(0, 120) : ''
  const choix = TableSchema.safeParse({ schema: searchParams.schema, table: searchParams.table })
  const [inventaire, colonnes] = await Promise.all([
    listerTables(source.id, recherche).catch(() => null),
    choix.success ? listerColonnes(source.id, choix.data).catch(() => null) : Promise.resolve(null),
  ])
  const chemin = '/sources/' + source.id
  const typeSource = { postgresql: 'PostgreSQL', mysql: 'MySQL', rest: 'API REST', fichier: 'Fichier' }
  const element = source.type === 'fichier' ? 'feuille' : source.type === 'rest' ? 'collection' : 'table'

  return (
    <section className="mx-auto max-w-6xl space-y-5 py-6">
      <Link className="text-sm text-primary hover:underline" href="/sources">Toutes les sources</Link>
      <header>
        <h1 className="text-2xl font-bold">{source.titre}</h1>
        <p className="text-sm text-muted-foreground">{typeSource[source.type]} · {source.type === 'fichier' ? source.base : source.hote + ' · ' + source.base}</p>
      </header>
      {source.type === 'fichier' && (
        <details className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer font-semibold">Remplacer le fichier source</summary>
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">Conservez les noms des feuilles et des colonnes sélectionnées, puis relancez les imports liés pour publier les nouvelles données.</p>
            <FormulaireFichierSource sourceId={source.id} />
          </div>
        </details>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(17rem,1fr)_minmax(0,2fr)]">
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">{source.type === 'fichier' ? 'Feuilles accessibles' : source.type === 'rest' ? 'Collections accessibles' : 'Tables accessibles'}</h2>
          <form method="get" action={chemin} className="space-y-2">
            <Label htmlFor="table-q">{source.type === 'fichier' ? 'Rechercher une feuille' : source.type === 'rest' ? 'Rechercher une collection' : 'Rechercher par schéma ou table'}</Label>
            <div className="flex gap-2">
              <Input id="table-q" name="q" defaultValue={recherche} maxLength={120} />
              <Button type="submit" variant="outline">Rechercher</Button>
            </div>
          </form>
          {inventaire === null && <p role="alert" className="text-sm text-destructive">Inventaire indisponible. Vérifiez la connexion et les droits du compte source.</p>}
          {inventaire?.tables.length === 0 && <p className="text-sm">Aucune {element} trouvée.</p>}
          {inventaire?.tronque && <p className="text-sm">200 résultats affichés. Affinez la recherche pour en voir d’autres.</p>}
          <ul className="max-h-[32rem] divide-y overflow-auto">
            {inventaire?.tables.map(({ schema, table }) => {
              const active = choix.success && choix.data.schema === schema && choix.data.table === table
              const query = new URLSearchParams({ schema, table, ...(recherche ? { q: recherche } : {}) })
              return (
                <li key={JSON.stringify([schema, table])}>
                  <Link href={chemin + '?' + query.toString()} prefetch={false} aria-current={active ? 'page' : undefined}
                    className={'block break-all rounded px-2 py-2 text-sm hover:bg-muted ' + (active ? 'bg-muted font-medium' : '')}>
                    {schema}.{table}
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
        <section className="min-w-0 space-y-4 rounded-lg border bg-card p-4">
          <h2 className="break-all font-semibold">{choix.success ? choix.data.schema + '.' + choix.data.table : 'Nouvel import'}</h2>
          {!choix.success && <p className="text-sm text-muted-foreground">Choisissez une {element} pour voir ses colonnes et préparer un import.</p>}
          {choix.success && !colonnes?.length && <p role="status" className="text-sm">Aucune colonne lisible pour cette {element}.</p>}
          {choix.success && !!colonnes?.length && (
            <FormulaireImport key={JSON.stringify(choix.data)} sourceId={source.id} {...choix.data} colonnes={colonnes} />
          )}
        </section>
      </div>
    </section>
  )
}
