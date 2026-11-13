import Link from 'next/link'
import { redirect } from 'next/navigation'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { ActionsTableau } from './actions-tableau'
import { listerTableaux } from '@/lib/warehouse/tableaux'
import { listerAlertesTableaux } from '@/lib/warehouse/tableaux-alertes'

export default async function TableauxPage() {
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const [tableaux, alertes] = await Promise.all([listerTableaux(acces.contexte), listerAlertesTableaux(acces.contexte)])
  const date = new Intl.DateTimeFormat('fr', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Tableaux de bord</h1>
        <Link className="rounded-md bg-primary px-4 py-2 text-primary-foreground" href="/tableaux/nouveau">Créer un tableau</Link>
      </div>
      {!tableaux.length && <p className="text-muted-foreground">Aucun tableau de bord disponible.</p>}
      <ul className="space-y-3">
        {tableaux.map(t => <li key={t.id} className="flex flex-wrap justify-between gap-2 rounded-lg border bg-card p-4">
          <Link className="font-medium hover:underline" href={`/tableaux/${t.id}`}>{t.titre}</Link>
          {!t.editable && <span className="text-sm text-muted-foreground">Partagé avec vous</span>}
          {t.editable && <ActionsTableau id={t.id} titre={t.titre} />}
        </li>)}
      </ul>
      {alertes.length > 0 && <section className="space-y-3" aria-labelledby="alertes-titre">
        <h2 id="alertes-titre" className="text-lg font-semibold">Alertes récentes</h2>
        <ul className="divide-y rounded-lg border bg-card">
          {alertes.map(alerte => <li key={alerte.id} className="flex flex-wrap justify-between gap-2 p-3">
            <Link className="text-sm hover:underline" href={`/tableaux/${alerte.tableau}`}>Seuil atteint · {alerte.titre}</Link>
            <time className="text-sm text-muted-foreground" dateTime={alerte.date.toISOString()}>{date.format(alerte.date)} UTC</time>
          </li>)}
        </ul>
      </section>}
    </section>
  )
}
