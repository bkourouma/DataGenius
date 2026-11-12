import Link from 'next/link'
import { redirect } from 'next/navigation'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { listerEspaces } from '@/lib/warehouse/espaces'

export default async function EspacesPage() {
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const espaces = await listerEspaces(acces.contexte)
  return <section className="mx-auto max-w-5xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Espaces de données</h1>
      {acces.contexte.roleName === 'TenantAdmin' && <Link href="/sources/droits/espaces" className="text-sm font-medium text-primary hover:underline">Gérer les espaces</Link>}
    </div>
    {!espaces.length && <p className="text-muted-foreground">Aucun espace accessible.</p>}
    <div className="grid gap-4 md:grid-cols-2">
      {espaces.map(espace => <article key={espace.id} className="space-y-2 rounded-lg border bg-card p-4">
        <h2 className="text-lg font-semibold">{espace.nom}</h2>
        {espace.description && <p className="text-sm text-muted-foreground">{espace.description}</p>}
        <ul className="list-disc space-y-1 pl-5 text-sm">{espace.jeux.map(jeu => <li key={jeu.cle}>{jeu.titre}</li>)}</ul>
      </article>)}
    </div>
  </section>
}
