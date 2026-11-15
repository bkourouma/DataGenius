import { AlertTriangle, Info } from 'lucide-react'
import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { jeuxPourCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { FormulaireCombinaison } from './formulaire'

export const dynamic = 'force-dynamic'

export default async function Combiner() {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/assistant')
  const jeux = await jeuxPourCombinaison().catch(() => null)
  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <EnTetePage
        retour={{ href: '/sources', libelle: 'Sources' }}
        titre="Combiner des jeux de données"
        description="Choisissez deux jeux, les colonnes qui les relient et celles à conserver dans le résultat."
      />
      {jeux === null && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-danger-soft p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />Catalogue indisponible. Vérifiez l’état de l’entrepôt.
        </p>
      )}
      {jeux && (jeux.length < 2
        ? <p role="status" className="flex items-start gap-2 rounded-lg border bg-card p-5 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />Configurez au moins deux imports depuis la page Source.</p>
        : <FormulaireCombinaison jeux={jeux} />)}
    </section>
  )
}
