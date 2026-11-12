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
  return <main className="mx-auto grid max-w-lg gap-5 p-6 sm:p-10">
    <h1 className="text-xl font-semibold">Autoriser l’affichage d’un tableau</h1>
    <p>L’application <strong className="break-all">{origine}</strong> souhaite afficher le tableau <strong>{lisible.definition.titre}</strong> avec vos droits Data Genius.</p>
    <Consentement tableau={tableau.data} origine={origine} nonce={nonce.data} />
  </main>
}
