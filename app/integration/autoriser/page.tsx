import { Database } from 'lucide-react'
import { notFound, redirect } from 'next/navigation'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { nonceIntegration, origineAutorisee, tableauId } from '@/lib/integration/embarquement'
import { chargerTableau } from '@/lib/warehouse/tableaux'
import { Consentement } from './consentement'

export const dynamic = 'force-dynamic'

export default async function Autoriser({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const tableau = tableauId.safeParse(searchParams.tableau)
  const nonce = nonceIntegration.safeParse(searchParams.nonce)
  const origine = searchParams.origine
  if (!tableau.success || !nonce.success || typeof origine !== 'string' || !origineAutorisee(origine)) notFound()
  const acces = await exigerMedicAssist()
  if (!acces.ok) {
    if (acces.reponse.status !== 401) notFound()
    const retour = '/integration/autoriser?' + new URLSearchParams({ tableau: tableau.data, origine, nonce: nonce.data })
    redirect('/login?' + new URLSearchParams({ retour }))
  }
  const lisible = await chargerTableau(tableau.data, acces.contexte)
  if (!lisible) notFound()
  return <main className="grid min-h-dvh place-items-center bg-muted/50 px-4 py-10">
    <section className="w-full max-w-md rounded-xl border bg-card p-7 shadow-sm">
      <div className="mb-6 flex items-center gap-2.5 font-semibold">
        <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
          <Database size={18} aria-hidden />
        </span>
        Data Genius
      </div>
      <h1 className="text-xl font-semibold">Autoriser l’affichage d’un tableau</h1>
      <p className="mb-6 mt-3 text-sm text-muted-foreground">L’application <strong className="break-all text-foreground">{origine}</strong> souhaite afficher le tableau <strong className="text-foreground">{lisible.definition.titre}</strong> avec vos droits Data Genius.</p>
      <Consentement tableau={tableau.data} origine={origine} nonce={nonce.data} />
    </section>
  </main>
}
