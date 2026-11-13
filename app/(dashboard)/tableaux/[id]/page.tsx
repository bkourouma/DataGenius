import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { VueArtefactSuivi } from '@/components/medic-assist/suivi/vue-artefact-suivi'
import { ActionsTableau } from '../actions-tableau'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { lireTableau } from '@/lib/warehouse/tableaux'

function cellule(valeur: unknown) {
  return valeur === null || valeur === undefined ? '—' : String(valeur)
}

export default async function TableauPage({ params, searchParams }: {
  params: { id: string }
  searchParams: Record<string, string | string[] | undefined>
}) {
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const { filtre: cle, valeur, detail } = searchParams
  const filtre = typeof cle === 'string' && typeof valeur === 'string' && cle.length <= 63 && valeur.length <= 300 && cle && valeur
    ? { cle, valeur } : undefined
  const tableau = await lireTableau(params.id, acces.contexte, filtre, typeof detail === 'string' ? detail : undefined)
  if (!tableau) notFound()
  const base = `/tableaux/${tableau.id}`
  const filtreActif = filtre && tableau.filtres.includes(filtre.cle) ? filtre : undefined
  const query = new URLSearchParams(filtreActif ? { filtre: filtreActif.cle, valeur: filtreActif.valeur } : {})

  return <section className="mx-auto max-w-6xl space-y-5">
    <Link className="text-sm text-primary hover:underline" href="/tableaux">Tous les tableaux</Link>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{tableau.titre}</h1>
      {tableau.editable && <Link className="rounded-md border px-3 py-2 text-sm hover:bg-muted" href={`${base}/modifier`}>Modifier</Link>}
    </div>
    {tableau.editable && <ActionsTableau id={tableau.id} titre={tableau.titre} />}
    {tableau.filtres.length > 0 && <form method="get" action={base} className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
      <label className="grid gap-1 text-sm">Filtre commun
        <select name="filtre" className="h-9 rounded-md border bg-background px-2" defaultValue={filtreActif?.cle ?? ''} required>
          <option value="">Choisir un filtre</option>
          {tableau.filtres.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Valeur exacte
        <input name="valeur" required maxLength={300} defaultValue={filtreActif?.valeur} className="h-9 rounded-md border bg-background px-2" />
      </label>
      <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground">Appliquer</button>
      {filtreActif && <Link href={base} className="py-2 text-sm hover:underline">Effacer le filtre</Link>}
    </form>}
    {!tableau.tuiles.length && <p className="text-muted-foreground">Ce tableau ne contient encore aucune tuile.</p>}
    <div className="grid gap-4 md:grid-cols-2">
      {tableau.tuiles.map(tuile => {
        const voirDetail = detail === tuile.id
        const detailQuery = new URLSearchParams(query)
        if (!voirDetail) detailQuery.set('detail', tuile.id)
        const hrefDetail = detailQuery.size ? `${base}?${detailQuery}` : base
        if (tuile.type === 'indisponible') return <article key={tuile.id} className="rounded-lg border bg-card p-4 text-muted-foreground">Tuile indisponible.</article>
        if (tuile.type === 'artefact') return <article key={tuile.id} className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">{tuile.artefact.titre}</h2>
          <p className="text-sm text-muted-foreground">Artefact · version {tuile.artefact.version}</p>
          {filtreActif && <p className="text-sm text-muted-foreground">L’artefact conserve ses filtres enregistrés.</p>}
          <VueArtefactSuivi artefactId={tuile.artefact.id} compact />
          <Link className="text-sm text-primary hover:underline" href={`/medic-assist/analyses/${encodeURIComponent(tuile.artefact.id)}`}>Ouvrir l’artefact</Link>
          {tuile.artefact.jeux.some(jeu => jeu.regles.length > 0) && <details className="text-sm text-muted-foreground">
            <summary>Provenance de l’artefact</summary>
            <ul className="mt-2 list-disc pl-5">{[...new Set(tuile.artefact.jeux.flatMap(jeu => jeu.regles))].map(regle => <li key={regle}>{regle}</li>)}</ul>
          </details>}
        </article>
        const { resultat } = tuile
        const valeur = resultat.lignes[0]?.[resultat.colonnes[0]?.cle]
        return <article key={tuile.id} className={`min-w-0 space-y-3 rounded-lg border bg-card p-4 ${voirDetail ? 'md:col-span-2' : ''}`}>
          <h2 className="font-semibold">{tuile.libelle}</h2>
          {!voirDetail && <p className="text-3xl font-semibold tabular-nums">{cellule(valeur)} {tuile.unite}</p>}
          {tuile.objectif !== undefined && <p className="text-sm text-muted-foreground">
            Objectif {tuile.objectif} {tuile.unite}{tuile.objectifAtteint === true ? ' · Atteint' : tuile.objectifAtteint === false ? ' · À atteindre' : ''}
          </p>}
          {filtreActif && !tuile.filtreApplique && <p className="text-sm text-muted-foreground">Ce jeu ne propose pas le filtre sélectionné.</p>}
          {voirDetail && <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Détail de {tuile.libelle}</caption>
              <thead><tr>{resultat.colonnes.map(c => <th key={c.cle} scope="col" className="border-b p-2">{c.libelle}</th>)}</tr></thead>
              <tbody>{resultat.lignes.map((ligne, index) => <tr key={index}>{resultat.colonnes.map(c => <td key={c.cle} className="border-b p-2">{cellule(ligne[c.cle])}</td>)}</tr>)}</tbody>
            </table>
            {!resultat.lignes.length && <p className="p-2 text-sm text-muted-foreground">Aucun résultat.</p>}
            {resultat.tronque && <p className="p-2 text-sm text-muted-foreground">Le détail est limité aux 40 premières lignes.</p>}
          </div>}
          {tuile.dimensions.length > 0 && <Link className="text-sm text-primary hover:underline" href={hrefDetail}>{voirDetail ? 'Masquer le détail' : 'Explorer le détail'}</Link>}
          <details className="text-sm text-muted-foreground">
            <summary>Provenance</summary>
            <p className="mt-2">{resultat.provenance.libelleSource} {resultat.provenance.periode?.libelle}</p>
            <ul className="list-disc pl-5">{resultat.provenance.regles.map(regle => <li key={regle}>{regle}</li>)}</ul>
          </details>
        </article>
      })}
    </div>
  </section>
}
