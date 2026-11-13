import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BellRing, ChevronRight, LayoutDashboard, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EnTetePage, EtatVide } from '@/components/ui/en-tete-page'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { listerTableaux } from '@/lib/warehouse/tableaux'
import { listerAlertesTableaux } from '@/lib/warehouse/tableaux-alertes'

export default async function TableauxPage() {
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const [tableaux, alertes] = await Promise.all([listerTableaux(acces.contexte), listerAlertesTableaux(acces.contexte)])
  const date = new Intl.DateTimeFormat('fr', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
  const creer = (
    <Button asChild>
      <Link href="/tableaux/nouveau"><Plus aria-hidden />Créer un tableau</Link>
    </Button>
  )
  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <EnTetePage
        titre="Tableaux de bord"
        description="Suivez vos indicateurs clés sur une seule page et partagez-la avec votre équipe."
        actions={tableaux.length > 0 ? creer : undefined} />
      {!tableaux.length && (
        <EtatVide icone={<LayoutDashboard />} titre="Aucun tableau de bord pour l’instant" action={creer}>
          Un tableau réunit des indicateurs et des analyses enregistrées pour les consulter d’un coup d’œil, avec des filtres communs.
        </EtatVide>
      )}
      {tableaux.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {tableaux.map(t => (
            <li key={t.id}>
              <Link
                href={`/tableaux/${t.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{t.titre}</span>
                {!t.editable && <Badge variant="outline" className="shrink-0">Partagé avec vous</Badge>}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {alertes.length > 0 && (
        <section className="space-y-3" aria-labelledby="alertes-titre">
          <h2 id="alertes-titre" className="text-lg font-semibold">Alertes récentes</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {alertes.map(alerte => (
              <li key={alerte.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <BellRing className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Link className="min-w-0 flex-1 text-sm hover:underline" href={`/tableaux/${alerte.tableau}`}>{alerte.titre}</Link>
                <Badge variant="warning">Seuil atteint</Badge>
                <time className="text-sm tabular-nums text-muted-foreground" dateTime={alerte.date.toISOString()}>{date.format(alerte.date)} UTC</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
