import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { toIntlTag } from '@/i18n/config'
import { listerComptes } from '@/lib/auth/comptes'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { FormulaireInvitation, ListeComptes } from './composants'

export const dynamic = 'force-dynamic'

export default async function UtilisateursPage() {
  const t = await getTranslations('ecrans.utilisateurs')
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) redirect('/assistant')
  const comptes = await listerComptes()
  const nombre = new Intl.NumberFormat(toIntlTag(await getLocale())).format(comptes.length)
  const serialisables = comptes.map(c => ({ ...c, invitationExpireA: c.invitationExpireA?.toISOString() ?? null }))
  return <section className="mx-auto max-w-5xl space-y-8 py-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold">{t('titre')}</h1>
      <p className="text-sm text-muted-foreground">
        {t('description')}
      </p>
    </header>
    <section className="space-y-3" aria-labelledby="inviter">
      <h2 id="inviter" className="text-lg font-semibold">{t('inviterTitre')}</h2>
      <FormulaireInvitation />
    </section>
    <section className="space-y-3" aria-labelledby="comptes">
      <h2 id="comptes" className="text-lg font-semibold">{t('comptes', { n: nombre })}</h2>
      <ListeComptes comptes={serialisables} utilisateurCourantId={acces.contexte.userId} />
    </section>
  </section>
}
