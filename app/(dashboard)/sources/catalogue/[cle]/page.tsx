import { CheckCircle2 } from 'lucide-react'
import { notFound, redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { chargerCatalogueMetier } from '@/lib/warehouse/catalogue-metier'
import { EnTetePage } from '@/components/ui/en-tete-page'
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
    <section className="mx-auto max-w-4xl space-y-6">
      <EnTetePage
        retour={{ href: '/sources', libelle: 'Sources' }}
        titre={'Catalogue métier · ' + catalogue.titre}
        description="Définissez le sens métier des colonnes pour que les réponses restent cohérentes."
      />
      {searchParams.publication === 'ok' && (
        <p role="status" className="flex items-center gap-2 rounded-md bg-success-soft p-3 text-sm text-success">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />Définition publiée.
        </p>
      )}
      <FormulaireCatalogue key={catalogue.version} catalogue={catalogue} />
      {catalogue.historique.length > 0 && (
        <section className="space-y-2 rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold">Versions publiées</h2>
          <ul className="divide-y text-sm">
            {catalogue.historique.map(v => <li key={v.version} className="flex items-center justify-between gap-3 py-2"><span>Version {v.version}</span><span className="text-muted-foreground">{date.format(v.publieA)} UTC</span></li>)}
          </ul>
        </section>
      )}
    </section>
  )
}
