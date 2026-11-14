import Link from 'next/link'
import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { configurationDroits } from '@/lib/warehouse/droits-admin'
import { definitionsEspaces } from '@/lib/warehouse/espaces'
import { FormulaireEspace } from './formulaire'

export default async function GererEspacesPage() {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/assistant')
  const [{ groupes, jeux }, espaces] = await Promise.all([configurationDroits(), definitionsEspaces()])
  const affectations = new Map(espaces.flatMap(e => e.jeux.map(jeu => [jeu, e.id] as const)))
  const choix = (id?: string) => jeux.map(jeu => ({ cle: jeu.cle, titre: jeu.titre,
    occupe: affectations.has(jeu.cle) && affectations.get(jeu.cle) !== id }))
  return <section className="mx-auto max-w-4xl space-y-5 py-6">
    <Link href="/sources/droits" className="text-sm text-primary hover:underline">Groupes et droits</Link>
    <h1 className="text-2xl font-bold">Gérer les espaces de données</h1>
    <p className="text-sm text-muted-foreground">Les membres doivent avoir accès à l’espace et satisfaire les règles du jeu.</p>
    {espaces.map(espace => <details key={espace.id} className="space-y-2">
      <summary className="cursor-pointer font-medium">{espace.nom} · {espace.jeux.length} jeu(x)</summary>
      <FormulaireEspace key={espace.version} espace={espace} groupes={groupes} jeux={choix(espace.id)} />
    </details>)}
    <h2 className="text-lg font-semibold">Nouvel espace</h2>
    <FormulaireEspace groupes={groupes} jeux={choix()} />
  </section>
}
