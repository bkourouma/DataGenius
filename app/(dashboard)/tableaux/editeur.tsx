import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { listerAnalyses } from '@/lib/medic-assist/suivi/analyses'
import { chargerComptesAvecAcces } from '@/lib/medic-assist/suivi/comptes'
import { chargerTableau, optionsTableau } from '@/lib/warehouse/tableaux'
import { FormulaireTableau } from './formulaire'

export async function EditeurTableau({ id }: { id?: string }) {
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const { contexte } = acces
  const tableau = id ? await chargerTableau(id, contexte) : null
  if (id && !tableau?.editable) notFound()
  const [options, comptes, analyses] = await Promise.all([
    optionsTableau(contexte),
    chargerComptesAvecAcces({ exclureId: contexte.userId, limite: 100 }),
    listerAnalyses(contexte, { page: 1, taille: 100 }),
  ])
  const lecteurs = tableau?.definition.lecteurs ?? []
  const manquants = lecteurs.filter(id => !comptes.some(compte => compte.id === id))
  const anciensLecteurs = manquants.length ? await chargerComptesAvecAcces({ ids: manquants, limite: manquants.length }) : []
  return <section className="mx-auto max-w-4xl space-y-5">
    <Link className="text-sm text-primary hover:underline" href={id ? `/tableaux/${id}` : '/tableaux'}>Retour</Link>
    <h1 className="text-2xl font-semibold">{id ? 'Modifier le tableau' : 'Créer un tableau de bord'}</h1>
    <FormulaireTableau tableau={tableau} options={options}
      comptes={[...comptes, ...anciensLecteurs].map(c => ({ id: c.id, nom: c.nom, email: c.email }))}
      analyses={analyses.lignes.map(a => ({ id: a.artefactId, titre: a.titre }))} />
  </section>
}
