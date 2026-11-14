import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { notFound, redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { chargerIncremental } from '@/lib/warehouse/incremental-admin'
import { Badge } from '@/components/ui/badge'
import { EnTetePage } from '@/components/ui/en-tete-page'
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
  if (!(await exigerAdminMedicAssist()).ok) redirect('/assistant')
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(params.cle)) notFound()
  const jeu = await chargerIncremental(params.cle)
  if (!jeu) notFound()
  const date = jeu.etat?.reconcilie_a?.toLocaleString('fr', { timeZone: 'UTC' })
  const message = messages.get(searchParams.etat ?? '')
  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <EnTetePage
        retour={{ href: '/sources/qualite/' + jeu.cle, libelle: 'Qualité et suivi' }}
        titre={'Synchronisation incrémentale · ' + jeu.titre}
        description="La source doit mettre à jour l’horodatage à chaque modification. Une réconciliation relit toutes les lignes pour détecter les suppressions."
      />
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="text-base font-semibold">État actuel</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Mode</dt><dd className="mt-0.5">{jeu.etat ? <Badge variant="success">Incrémental activé</Badge> : <Badge variant="outline">Lecture complète</Badge>}</dd></div>
          <div><dt className="text-muted-foreground">Dernière réconciliation</dt><dd>{date ? date + ' UTC' : '—'}</dd></div>
          {jeu.etat?.curseur && <div><dt className="text-muted-foreground">Dernier horodatage lu</dt><dd>{jeu.etat.curseur}</dd></div>}
        </dl>
      </section>
      {message && (searchParams.etat === 'echec'
        ? <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft p-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{message}</p>
        : <p role="status" className={'flex items-start gap-2 rounded-md p-3 text-sm ' + (searchParams.etat === 'en_cours' ? 'bg-warning-soft text-yellow-800' : 'bg-success-soft text-success')}>
            {searchParams.etat === 'en_cours' ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />}{message}
          </p>)}
      <FormulaireIncremental key={jeu.etat?.version ?? 0} jeu={jeu} />
    </section>
  )
}
