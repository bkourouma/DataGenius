import type { previsualiserCombinaison } from '@/lib/warehouse/combinaisons-admin'

export type ResultatApercu = Awaited<ReturnType<typeof previsualiserCombinaison>>

function nombreExact(valeur: string | null) {
  if (valeur === null) return '—'
  const [entier, decimales] = valeur.split('.')
  const groupe = entier.replace(/\B(?=(\d{3})+$)/g, '\u202f')
  return decimales === undefined ? groupe : `${groupe},${decimales}`
}

function tauxCorrespondance(correspondances: string, lignes: string) {
  if (lignes === '0') return '—'
  const dixiemes = BigInt(correspondances) * BigInt(1000) / BigInt(lignes)
  if (dixiemes === BigInt(0) && correspondances !== '0') return '< 0,1 %'
  return Number(dixiemes / BigInt(10)).toLocaleString('fr-FR') + ',' + (dixiemes % BigInt(10)) + ' %'
}

function DiagnosticJointure({ diagnostic }: { diagnostic: ResultatApercu['diagnostic'] }) {
  const mesures = [
    ['Lignes du jeu source', 'lignes'],
    ['Lignes avec correspondance', 'correspondances'],
    ['Lignes sans correspondance', 'sansCorrespondance'],
    ['Lignes avec une clé incomplète', 'lignesCleNulle'],
    ['Clés complètes présentes plusieurs fois', 'clesDupliquees'],
    ['Lignes répétées dans le résultat', 'lignesMultipliees'],
  ] as const
  const { gauche, droite, resultat, totaux } = diagnostic
  return (
    <div className="space-y-3">
      <h3 className="font-medium">Diagnostic de la jointure</h3>
      <p className="text-sm">Lignes dans le résultat complet <strong>{nombreExact(resultat)}</strong></p>
      {(gauche.lignesMultipliees !== '0' || droite.lignesMultipliees !== '0') && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Certaines lignes ont plusieurs correspondances et apparaissent plusieurs fois. Vérifiez les sommes du résultat avant d’utiliser ce jeu.
        </p>
      )}
      <div className="overflow-auto rounded-md border" tabIndex={0} role="region" aria-label="Correspondances par jeu">
        <table className="w-full text-start text-sm">
          <thead className="bg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-start">Mesure</th>
              <th scope="col" className="px-3 py-2 text-end">Premier jeu</th>
              <th scope="col" className="px-3 py-2 text-end">Deuxième jeu</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {mesures.map(([libelle, cle]) => (
              <tr key={cle}>
                <th scope="row" className="px-3 py-2 text-start font-normal">{libelle}</th>
                <td className="px-3 py-2 text-end tabular-nums">{nombreExact(gauche[cle])}</td>
                <td className="px-3 py-2 text-end tabular-nums">{nombreExact(droite[cle])}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-3 py-2 text-start font-normal">Taux de correspondance</th>
              <td className="px-3 py-2 text-end tabular-nums">{tauxCorrespondance(gauche.correspondances, gauche.lignes)}</td>
              <td className="px-3 py-2 text-end tabular-nums">{tauxCorrespondance(droite.correspondances, droite.lignes)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {totaux.length > 0 && (
        <div className="overflow-auto rounded-md border" tabIndex={0} role="region" aria-label="Comparaison des sommes">
          <table className="w-full text-start text-sm">
            <caption className="px-3 py-2 text-start font-medium">Sommes des colonnes numériques sélectionnées</caption>
            <thead className="bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start">Colonne</th>
                <th scope="col" className="px-3 py-2 text-end">Dans le jeu source</th>
                <th scope="col" className="px-3 py-2 text-end">Dans le résultat</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {totaux.map(({ cote, colonne, avant, apres }) => (
                <tr key={colonne.nom}>
                  <th scope="row" className="px-3 py-2 text-start font-normal">
                    {colonne.description} · {cote === 'gauche' ? 'Premier jeu' : 'Deuxième jeu'}
                  </th>
                  <td className="px-3 py-2 text-end tabular-nums">{nombreExact(avant)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{nombreExact(apres)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function ApercuJointure({ resultat, afficherCorrespondances }: {
  resultat: ResultatApercu
  afficherCorrespondances: boolean
}) {
  const { colonnes, lignes, tronque, diagnostic } = resultat
  return (
    <section className="space-y-3 rounded-lg border bg-background p-4" aria-labelledby="titre-apercu">
      <h2 id="titre-apercu" className="font-semibold">Aperçu du résultat</h2>
      <DiagnosticJointure diagnostic={diagnostic} />
      {lignes.length === 0 ? (
        <p role="status" className="text-sm">Aucune ligne pour cette jointure. Vérifiez les colonnes de liaison et le mode choisi.</p>
      ) : (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            {tronque ? '20 lignes affichées. Le résultat contient d’autres lignes.' :
              lignes.length === 1 ? '1 ligne dans le résultat.' : lignes.length + ' lignes dans le résultat.'}
          </p>
          <div className="max-h-96 overflow-auto rounded-md border" tabIndex={0} role="region" aria-label="Tableau de prévisualisation">
            <table className="w-full border-collapse text-start text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {afficherCorrespondances && <th scope="col" className="px-3 py-2 text-start">Correspondance</th>}
                  {colonnes.map(colonne => (
                    <th key={colonne.nom} scope="col" className="min-w-28 px-3 py-2 text-start">
                      {colonne.description}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {lignes.map((ligne, i) => (
                  <tr key={i}>
                    {afficherCorrespondances && (
                      <td className="whitespace-nowrap px-3 py-2">
                        {ligne.correspondance ? 'Trouvée' : 'Sans correspondance'}
                      </td>
                    )}
                    {ligne.cellules.map((valeur, j) => (
                      <td key={colonnes[j].nom} className="max-w-72 break-words px-3 py-2 align-top">
                        {valeur ?? <span aria-label="Valeur nulle" className="text-muted-foreground">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
