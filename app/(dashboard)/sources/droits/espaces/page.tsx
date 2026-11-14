import { redirect } from 'next/navigation'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { configurationDroits } from '@/lib/warehouse/droits-admin'
import { definitionsEspaces } from '@/lib/warehouse/espaces'
import { FormulaireEspace } from './formulaire'

export default async function GererEspacesPage() {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/medic-assist')
  const [{ groupes, jeux }, espaces] = await Promise.all([configurationDroits(), definitionsEspaces()])
  const affectations = new Map(espaces.flatMap(e => e.jeux.map(jeu => [jeu, e.id] as const)))
  const choix = (id?: string) => jeux.map(jeu => ({ cle: jeu.cle, titre: jeu.titre,
    occupe: affectations.has(jeu.cle) && affectations.get(jeu.cle) !== id }))
  return <section className="mx-auto max-w-4xl space-y-8 py-6">
    <EnTetePage retour={{ href: '/sources/droits', libelle: 'Droits d’accès' }} titre="Gérer les espaces de données"
      description="Les membres doivent avoir accès à l’espace et satisfaire les règles du jeu." />
    <section className="space-y-3" aria-labelledby="espaces-existants">
      <h2 id="espaces-existants" className="text-lg font-semibold">Espaces existants</h2>
      {espaces.length === 0 && <p className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">Aucun espace pour le moment. Créez le premier ci-dessous.</p>}
      {espaces.map(espace => <details key={espace.id} className="group rounded-lg border bg-card">
        <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 font-medium">
          <span>{espace.nom}</span>
          <span className="text-sm font-normal text-muted-foreground">{espace.jeux.length} jeu(x)</span>
        </summary>
        <div className="border-t p-4">
          <FormulaireEspace key={espace.version} espace={espace} groupes={groupes} jeux={choix(espace.id)} />
        </div>
      </details>)}
    </section>
    <section className="space-y-3" aria-labelledby="nouvel-espace">
      <h2 id="nouvel-espace" className="text-lg font-semibold">Nouvel espace</h2>
      <div className="rounded-lg border bg-card p-4">
        <FormulaireEspace groupes={groupes} jeux={choix()} />
      </div>
    </section>
  </section>
}
