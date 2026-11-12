import Link from 'next/link'
import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { configurationDroits } from '@/lib/warehouse/droits-admin'
import { Groupe, NouveauGroupe, RegleJeu } from './formulaires'

export const dynamic = 'force-dynamic'

export default async function DroitsSourcesPage() {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/medic-assist')
  const { groupes, membres, regles, jeux, audit } = await configurationDroits()
  const noms = new Map<string, string>([
    ...groupes.map(g => [g.id, g.nom] as const), ...jeux.map(j => [j.cle, j.titre] as const),
  ])
  const horodatage = new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
  return <section className="mx-auto max-w-4xl space-y-8 py-6">
    <header className="space-y-2">
      <Link href="/sources" className="text-sm text-primary hover:underline">Sources</Link>
      <h1 className="text-2xl font-bold">Droits sur les jeux de données</h1>
      <p className="text-sm text-muted-foreground">Les administrateurs ont accès à tous les jeux. Limitez la consultation des membres en configurant une règle par jeu.</p>
      <Link className="text-sm font-medium text-primary hover:underline" href="/sources/droits/espaces">Gérer les espaces de données</Link>
    </header>
    <section className="space-y-3" aria-labelledby="groupes-acces">
      <h2 id="groupes-acces" className="text-lg font-semibold">Groupes d’accès</h2>
      <NouveauGroupe />
      {groupes.map(g => <Groupe key={JSON.stringify(g)} groupe={g} membres={membres} />)}
    </section>
    <section className="space-y-3" aria-labelledby="regles-jeu">
      <h2 id="regles-jeu" className="text-lg font-semibold">Règles par jeu</h2>
      {jeux.length === 0 && <p className="text-sm text-muted-foreground">Aucun jeu disponible.</p>}
      {jeux.map(j => <RegleJeu key={j.cle + JSON.stringify(regles.get(j.cle) ?? null)} jeu={j} groupes={groupes} regle={regles.get(j.cle)} />)}
    </section>
    <section className="space-y-3" aria-labelledby="journal-acces">
      <h2 id="journal-acces" className="text-lg font-semibold">Journal des modifications</h2>
      {audit.length ? <ul className="divide-y rounded-md border">
        {audit.map(e => <li key={e.id} className="flex flex-wrap gap-x-3 p-3 text-sm">
          <time dateTime={e.fait_a.toISOString()} className="text-muted-foreground">{horodatage.format(e.fait_a)} UTC</time>
          <span>{e.action}</span><span>{noms.get(e.objet) ?? e.objet}</span><span className="text-muted-foreground">{e.acteur}</span>
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">Aucune modification enregistrée.</p>}
    </section>
  </section>
}
