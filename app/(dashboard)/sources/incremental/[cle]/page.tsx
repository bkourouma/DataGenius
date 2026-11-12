import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { chargerIncremental } from '@/lib/warehouse/incremental-admin'
import { FormulaireIncremental } from './formulaire'

export const dynamic = 'force-dynamic'

const messages = new Map([
  ['enregistre', 'Configuration enregistrée.'],
  ['publie', 'Copie publiée.'],
  ['identique', 'Synchronisation réussie. La copie publiée est inchangée.'],
  ['en_cours', 'Une synchronisation est déjà en cours.'],
  ['echec', 'La synchronisation a échoué. Consultez le suivi de l’import.'],
])

export default async function ImportIncremental({ params, searchParams }: {
  params: { cle: string }; searchParams: { etat?: string }
}) {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/medic-assist')
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(params.cle)) notFound()
  const jeu = await chargerIncremental(params.cle)
  if (!jeu) notFound()
  const date = jeu.etat?.reconcilie_a?.toLocaleString('fr', { timeZone: 'UTC' })
  const message = messages.get(searchParams.etat ?? '')
  return (
    <section className="mx-auto max-w-4xl space-y-5 py-6">
      <Link href={'/sources/qualite/' + jeu.cle} className="text-sm text-primary hover:underline">Qualité et suivi</Link>
      <h1 className="text-2xl font-bold">Synchronisation incrémentale · {jeu.titre}</h1>
      <p className="text-sm text-muted-foreground">La source doit mettre à jour l’horodatage à chaque modification. Une réconciliation relit toutes les lignes pour détecter les suppressions.</p>
      <dl className="grid gap-3 rounded-lg border bg-card p-5 text-sm sm:grid-cols-2">
        <div><dt>Mode</dt><dd>{jeu.etat ? 'Incrémental activé' : 'Lecture complète'}</dd></div>
        <div><dt>Dernière réconciliation</dt><dd>{date ? date + ' UTC' : '—'}</dd></div>
        {jeu.etat?.curseur && <div><dt>Dernier horodatage lu</dt><dd>{jeu.etat.curseur}</dd></div>}
      </dl>
      {message && <p role={searchParams.etat === 'echec' ? 'alert' : 'status'} className="text-sm">{message}</p>}
      <FormulaireIncremental key={jeu.etat?.version ?? 0} jeu={jeu} />
    </section>
  )
}
