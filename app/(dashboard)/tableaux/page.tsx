import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { BellRing, ChevronRight, LayoutDashboard, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EnTetePage, EtatVide } from '@/components/ui/en-tete-page'
import { toIntlTag } from '@/i18n/config'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { ActionsTableau } from './actions-tableau'
import { listerTableaux } from '@/lib/warehouse/tableaux'
import { listerAlertesTableaux } from '@/lib/warehouse/tableaux-alertes'

export default async function TableauxPage() {
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const t = await getTranslations('tableaux.liste')
  const tag = toIntlTag(await getLocale())
  const [tableaux, alertes] = await Promise.all([listerTableaux(acces.contexte), listerAlertesTableaux(acces.contexte)])
  const date = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
  const creer = (
    <Button asChild>
      <Link href="/tableaux/nouveau"><Plus aria-hidden />{t('creer')}</Link>
    </Button>
  )
  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <EnTetePage
        titre={t('titre')}
        description={t('description')}
        actions={tableaux.length > 0 ? creer : undefined} />
      {!tableaux.length && (
        <EtatVide icone={<LayoutDashboard />} titre={t('videTitre')} action={creer}>
          {t('videTexte')}
        </EtatVide>
      )}
      {tableaux.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {tableaux.map(tableau => (
            <li key={tableau.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
              <Link
                href={`/tableaux/${tableau.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 self-center rounded-sm py-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{tableau.titre}</span>
                {!tableau.editable && <Badge variant="outline" className="shrink-0">{t('partage')}</Badge>}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
              </Link>
              {tableau.editable && <ActionsTableau id={tableau.id} titre={tableau.titre} />}
            </li>
          ))}
        </ul>
      )}
      {alertes.length > 0 && (
        <section className="space-y-3" aria-labelledby="alertes-titre">
          <h2 id="alertes-titre" className="text-lg font-semibold">{t('alertesTitre')}</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {alertes.map(alerte => (
              <li key={alerte.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <BellRing className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Link className="min-w-0 flex-1 text-sm hover:underline" href={`/tableaux/${alerte.tableau}`}>{alerte.titre}</Link>
                <Badge variant="warning">{t('seuilAtteint')}</Badge>
                <time className="text-sm tabular-nums text-muted-foreground" dateTime={alerte.date.toISOString()}>{date.format(alerte.date)} UTC</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
