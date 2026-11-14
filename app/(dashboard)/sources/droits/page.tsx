import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Boxes } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { configurationDroits } from '@/lib/warehouse/droits-admin'
import { NouveauGroupe, TableauGroupes, TableauJeux } from './formulaires'

export const dynamic = 'force-dynamic'

const vide = 'text-sm text-muted-foreground'

export default async function DroitsSourcesPage() {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/assistant')
  const { groupes, membres, regles, jeux, audit } = await configurationDroits()
  const noms = new Map<string, string>([
    ...groupes.map(g => [g.id, g.nom] as const), ...jeux.map(j => [j.cle, j.titre] as const),
  ])
  const horodatage = new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
  return <section className="mx-auto max-w-4xl space-y-8">
    <EnTetePage retour={{ href: '/sources', libelle: 'Sources' }} titre="Droits sur les jeux de données"
      description="Les administrateurs ont accès à tous les jeux. Limitez la consultation des membres en configurant une règle par jeu."
      actions={<><Link href="/sources/droits/espaces" className={buttonVariants({ variant: 'outline' })}><Boxes aria-hidden />Gérer les espaces</Link><NouveauGroupe /></>} />
    <section className="space-y-3" aria-labelledby="groupes-acces">
      <h2 id="groupes-acces" className="text-lg font-semibold">Groupes d’accès</h2>
      <p className={vide}>Un groupe rassemble des membres auxquels vous ouvrez l’accès à certains jeux.</p>
      {groupes.length === 0 ? <p className={vide}>Aucun groupe pour le moment. Créez-en un pour pouvoir restreindre l’accès aux jeux.</p> : <TableauGroupes groupes={groupes} membres={membres} />}
    </section>
    <section className="space-y-3" aria-labelledby="regles-jeu">
      <h2 id="regles-jeu" className="text-lg font-semibold">Règles par jeu</h2>
      <p className={vide}>Un jeu sans règle reste ouvert à tous les membres.</p>
      {jeux.length === 0 ? <p className={vide}>Aucun jeu disponible. Ajoutez une source pour créer des jeux de données.</p> : <TableauJeux jeux={jeux} groupes={groupes} regles={regles} />}
    </section>
    <section className="space-y-3" aria-labelledby="journal-acces">
      <h2 id="journal-acces" className="text-lg font-semibold">Journal des modifications</h2>
      {audit.length ? <ul className="divide-y rounded-lg border bg-card">
        {audit.map(e => <li key={e.id} className="flex flex-wrap gap-x-3 p-3 text-sm">
          <time dateTime={e.fait_a.toISOString()} className="text-muted-foreground">{horodatage.format(e.fait_a)} UTC</time>
          <span>{e.action}</span><span>{noms.get(e.objet) ?? e.objet}</span><span className="text-muted-foreground">{e.acteur}</span>
        </li>)}
      </ul> : <p className={vide}>Aucune modification enregistrée.</p>}
    </section>
  </section>
}
