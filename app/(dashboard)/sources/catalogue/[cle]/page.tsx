import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { chargerCatalogueMetier } from '@/lib/warehouse/catalogue-metier'
import { FormulaireCatalogue } from './formulaire'

export const dynamic = 'force-dynamic'

export default async function CatalogueMetier({ params, searchParams }: {
  params: { cle: string }
  searchParams: { publication?: string }
}) {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/medic-assist')
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(params.cle)) notFound()
  const catalogue = await chargerCatalogueMetier(params.cle)
  if (!catalogue) notFound()

  const date = new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
  return (
    <section className="mx-auto max-w-4xl space-y-5 py-6">
      <Link href="/sources" className="text-sm text-primary hover:underline">Sources</Link>
      <h1 className="text-2xl font-bold">Catalogue métier · {catalogue.titre}</h1>
      {searchParams.publication === 'ok' && <p role="status" className="text-sm">Définition publiée.</p>}
      <FormulaireCatalogue key={catalogue.version} catalogue={catalogue} />
      {catalogue.historique.length > 0 && (
        <section className="space-y-2 rounded-lg border bg-card p-5">
          <h2 className="font-semibold">Versions publiées</h2>
          <ul className="divide-y text-sm">
            {catalogue.historique.map(v => <li key={v.version} className="py-2">Version {v.version} · {date.format(v.publieA)} UTC</li>)}
          </ul>
        </section>
      )}
    </section>
  )
}
