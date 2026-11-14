import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { chargerCombinaison, jeuxPourCombinaison } from '@/lib/warehouse/combinaisons-admin'
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
    <section className="mx-auto max-w-4xl space-y-5 py-6">
      <Link className="text-sm text-primary hover:underline" href="/sources#combinaisons">Jeux combinés</Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Modifier {edition.definition.titre}</h1>
        <p className="text-sm text-muted-foreground">Ajustez les lignes à conserver, les liaisons ou les colonnes du résultat, puis prévisualisez la jointure.</p>
      </header>
      {jeux === null && <p role="alert">Catalogue indisponible. Vérifiez l’état de l’entrepôt.</p>}
      {jeux && !disponible && <p role="alert">Un des jeux source est indisponible. Rétablissez-le pour modifier la combinaison.</p>}
      {jeux && disponible && <FormulaireCombinaison key={edition.revision} jeux={jeux} edition={edition} />}
    </section>
  )
}
