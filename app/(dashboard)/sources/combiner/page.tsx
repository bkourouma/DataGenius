import Link from 'next/link'
import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { jeuxPourCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { FormulaireCombinaison } from './formulaire'

export const dynamic = 'force-dynamic'

export default async function Combiner() {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/medic-assist')
  const jeux = await jeuxPourCombinaison().catch(() => null)
  return (
    <section className="mx-auto max-w-4xl space-y-5 py-6">
      <Link className="text-sm text-primary hover:underline" href="/sources">Toutes les sources</Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Combiner des jeux de données</h1>
        <p className="text-sm text-muted-foreground">Choisissez deux jeux, les colonnes qui les relient et celles à conserver dans le résultat.</p>
      </header>
      {jeux === null && <p role="alert">Catalogue indisponible. Vérifiez l’état de l’entrepôt.</p>}
      {jeux && (jeux.length < 2
        ? <p role="status">Configurez au moins deux imports depuis la page Source.</p>
        : <FormulaireCombinaison jeux={jeux} />)}
    </section>
  )
}
