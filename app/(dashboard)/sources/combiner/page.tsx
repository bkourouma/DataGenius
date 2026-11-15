import { AlertTriangle, Info } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { jeuxPourCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { FormulaireCombinaison } from './formulaire'

export const dynamic = 'force-dynamic'

export default async function Combiner() {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/assistant')
  const t = await getTranslations('sources.combiner.page')
  const jeux = await jeuxPourCombinaison().catch(() => null)
  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <EnTetePage
        retour={{ href: '/sources', libelle: t('retour') }}
        titre={t('titre')}
        description={t('description')}
      />
      {jeux === null && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-danger-soft p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{t('catalogueIndisponible')}
        </p>
      )}
      {jeux && (jeux.length < 2
        ? <p role="status" className="flex items-start gap-2 rounded-lg border bg-card p-5 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t('auMoinsDeux')}</p>
        : <FormulaireCombinaison jeux={jeux} />)}
    </section>
  )
}
