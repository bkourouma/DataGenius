import type { previsualiserCombinaison } from '@/lib/warehouse/combinaisons-admin'

export type ResultatApercu = Awaited<ReturnType<typeof previsualiserCombinaison>>

export function ApercuJointure({ resultat, afficherCorrespondances }: {
  resultat: ResultatApercu
  afficherCorrespondances: boolean
}) {
  const { colonnes, lignes, tronque } = resultat
  return (
    <section className="space-y-3 rounded-lg border bg-background p-4" aria-labelledby="titre-apercu">
      <h2 id="titre-apercu" className="font-semibold">Aperçu du résultat</h2>
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
