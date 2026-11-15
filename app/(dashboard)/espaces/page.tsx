import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Boxes, Settings2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { EnTetePage, EtatVide } from '@/components/ui/en-tete-page'
import { toIntlTag } from '@/i18n/config'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { listerEspaces } from '@/lib/warehouse/espaces'

export default async function EspacesPage() {
  const t = await getTranslations('ecrans.espaces')
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const espaces = await listerEspaces(acces.contexte)
  const entier = new Intl.NumberFormat(toIntlTag(acces.contexte.locale))
  const admin = acces.contexte.roleName === 'TenantAdmin'
  const gerer = admin && (
    <Link href="/sources/droits/espaces" className={buttonVariants({ variant: 'outline' })}>
      <Settings2 aria-hidden />{t('gerer')}
    </Link>
  )
  return <section className="mx-auto max-w-5xl space-y-6">
    <EnTetePage titre={t('titre')} description={t('description')} actions={gerer || undefined} />
    {!espaces.length && <EtatVide icone={<Boxes />} titre={t('aucunTitre')}
      action={gerer || undefined}>
      {admin ? t('aucunAdmin') : t('aucunMembre')}
    </EtatVide>}
    {espaces.length > 0 && <div className="grid gap-4 md:grid-cols-2">
      {espaces.map(espace => <article key={espace.id} className="space-y-3 rounded-lg border bg-card p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-base font-semibold">{espace.nom}</h2>
            <span className="text-xs text-muted-foreground">{t('nbJeux', { count: espace.jeux.length, n: entier.format(espace.jeux.length) })}</span>
          </div>
          {espace.description && <p className="text-sm text-muted-foreground">{espace.description}</p>}
        </div>
        {espace.jeux.length > 0
          ? <ul className="flex flex-wrap gap-1.5" aria-label={t('listeJeux')}>{espace.jeux.map(jeu => <li key={jeu.cle}><Badge variant="outline">{jeu.titre}</Badge></li>)}</ul>
          : <p className="text-sm text-muted-foreground">{t('aucunJeu')}</p>}
      </article>)}
    </div>}
  </section>
}
