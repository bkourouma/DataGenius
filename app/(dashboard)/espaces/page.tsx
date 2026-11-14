import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Boxes, Settings2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { EnTetePage, EtatVide } from '@/components/ui/en-tete-page'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { listerEspaces } from '@/lib/warehouse/espaces'

export default async function EspacesPage() {
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const espaces = await listerEspaces(acces.contexte)
  const admin = acces.contexte.roleName === 'TenantAdmin'
  const gerer = admin && (
    <Link href="/sources/droits/espaces" className={buttonVariants({ variant: 'outline' })}>
      <Settings2 aria-hidden />Gérer les espaces
    </Link>
  )
  return <section className="mx-auto max-w-5xl space-y-6">
    <EnTetePage titre="Espaces de données" description="Les espaces regroupent les jeux de données par équipe ou par sujet. Vous voyez ceux auxquels vous avez accès." actions={gerer || undefined} />
    {!espaces.length && <EtatVide icone={<Boxes />} titre="Aucun espace accessible"
      action={gerer || undefined}>
      {admin ? 'Créez un espace pour y regrouper des jeux de données et choisir qui peut les consulter.' : 'Demandez à un administrateur de vous donner accès à un espace.'}
    </EtatVide>}
    {espaces.length > 0 && <div className="grid gap-4 md:grid-cols-2">
      {espaces.map(espace => <article key={espace.id} className="space-y-3 rounded-lg border bg-card p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-base font-semibold">{espace.nom}</h2>
            <span className="text-xs text-muted-foreground">{espace.jeux.length} {espace.jeux.length > 1 ? 'jeux' : 'jeu'}</span>
          </div>
          {espace.description && <p className="text-sm text-muted-foreground">{espace.description}</p>}
        </div>
        {espace.jeux.length > 0
          ? <ul className="flex flex-wrap gap-1.5" aria-label="Jeux de données">{espace.jeux.map(jeu => <li key={jeu.cle}><Badge variant="outline">{jeu.titre}</Badge></li>)}</ul>
          : <p className="text-sm text-muted-foreground">Aucun jeu dans cet espace.</p>}
      </article>)}
    </div>}
  </section>
}
