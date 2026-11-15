import { AlertTriangle } from 'lucide-react'
import { notFound, redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { chargerCombinaison, jeuxPourCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { FormulaireCombinaison } from '../formulaire'

export const dynamic = 'force-dynamic'

export default async function ModifierJeuCombine({ params }: { params: { cle: string } }) {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/assistant')
  if (!/^combinaison_[0-9a-f]{32}$/.test(params.cle)) notFound()
  const [edition, jeux] = await Promise.all([
    chargerCombinaison(params.cle),
    jeuxPourCombinaison().catch(() => null),
  ])
  if (!edition) notFound()

  const disponible = jeux?.some(jeu => jeu.cle === edition.definition.gauche) &&
    jeux?.some(jeu => jeu.cle === edition.definition.droite)
  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <EnTetePage
        retour={{ href: '/sources#combinaisons', libelle: 'Jeux combinés' }}
        titre={'Modifier ' + edition.definition.titre}
        description="Ajustez les lignes à conserver, les liaisons ou les colonnes du résultat, puis prévisualisez la jointure."
      />
      {jeux === null && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-danger-soft p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />Catalogue indisponible. Vérifiez l’état de l’entrepôt.
        </p>
      )}
      {jeux && !disponible && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-sm text-yellow-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />Un des jeux source est indisponible. Rétablissez-le pour modifier la combinaison.
        </p>
      )}
      {jeux && disponible && <FormulaireCombinaison key={edition.revision} jeux={jeux} edition={edition} />}
    </section>
  )
}
