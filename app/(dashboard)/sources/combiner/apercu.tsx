import { useLocale, useTranslations } from 'next-intl'
import type { previsualiserCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { toIntlTag } from '@/i18n/config'

export type ResultatApercu = Awaited<ReturnType<typeof previsualiserCombinaison>>

/** Séparateurs de groupe et de décimale de la langue (le nombre reste manipulé en texte : chiffres exacts). */
function separateurs(tag: string) {
  const parties = new Intl.NumberFormat(tag).formatToParts(1234567.5)
  return {
    groupe: parties.find(p => p.type === 'group')?.value ?? '\u202f',
    decimale: parties.find(p => p.type === 'decimal')?.value ?? ',',
  }
}

function nombreExact(valeur: string | null, tag: string) {
  if (valeur === null) return '—'
  const { groupe, decimale } = separateurs(tag)
  const [entier, decimales] = valeur.split('.')
  const regroupe = entier.replace(/\B(?=(\d{3})+$)/g, groupe)
  return decimales === undefined ? regroupe : `${regroupe}${decimale}${decimales}`
}

function tauxCorrespondance(correspondances: string, lignes: string, tag: string, formater: (inferieur: boolean, valeur: string) => string) {
  if (lignes === '0') return '—'
  const { decimale } = separateurs(tag)
  const dixiemes = BigInt(correspondances) * BigInt(1000) / BigInt(lignes)
  if (dixiemes === BigInt(0) && correspondances !== '0') return formater(true, '0' + decimale + '1')
  return formater(false, new Intl.NumberFormat(tag).format(Number(dixiemes / BigInt(10))) + decimale + (dixiemes % BigInt(10)))
}

const COLONNES_MESURES = ['lignes', 'correspondances', 'sansCorrespondance', 'lignesCleNulle', 'clesDupliquees', 'lignesMultipliees'] as const

function DiagnosticJointure({ diagnostic }: { diagnostic: ResultatApercu['diagnostic'] }) {
  const t = useTranslations('sources.combiner.apercu')
  const tag = toIntlTag(useLocale())
  const nombre = (valeur: string | null) => nombreExact(valeur, tag)
  const formaterTaux = (inferieur: boolean, valeur: string) => inferieur ? t('tauxInferieur', { valeur }) : t('taux', { valeur })
  const { gauche, droite, resultat, totaux } = diagnostic
  return (
    <div className="space-y-3">
      <h3 className="font-medium">{t('diagnostic')}</h3>
      <p className="text-sm">{t('lignesResultatComplet')} <strong>{nombre(resultat)}</strong></p>
      {(gauche.lignesMultipliees !== '0' || droite.lignesMultipliees !== '0') && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {t('lignesMultiples')}
        </p>
      )}
      <div className="overflow-auto rounded-md border" tabIndex={0} role="region" aria-label={t('correspondancesParJeu')}>
        <table className="w-full text-start text-sm">
          <thead className="bg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-start">{t('mesure')}</th>
              <th scope="col" className="px-3 py-2 text-end">{t('premierJeu')}</th>
              <th scope="col" className="px-3 py-2 text-end">{t('deuxiemeJeu')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {COLONNES_MESURES.map(cle => (
              <tr key={cle}>
                <th scope="row" className="px-3 py-2 text-start font-normal">{t('mesures.' + cle)}</th>
                <td className="px-3 py-2 text-end tabular-nums">{nombre(gauche[cle])}</td>
                <td className="px-3 py-2 text-end tabular-nums">{nombre(droite[cle])}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-3 py-2 text-start font-normal">{t('tauxCorrespondance')}</th>
              <td className="px-3 py-2 text-end tabular-nums">{tauxCorrespondance(gauche.correspondances, gauche.lignes, tag, formaterTaux)}</td>
              <td className="px-3 py-2 text-end tabular-nums">{tauxCorrespondance(droite.correspondances, droite.lignes, tag, formaterTaux)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {totaux.length > 0 && (
        <div className="overflow-auto rounded-md border" tabIndex={0} role="region" aria-label={t('comparaisonSommes')}>
          <table className="w-full text-start text-sm">
            <caption className="px-3 py-2 text-start font-medium">{t('sommesTitre')}</caption>
            <thead className="bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start">{t('colonne')}</th>
                <th scope="col" className="px-3 py-2 text-end">{t('dansJeuSource')}</th>
                <th scope="col" className="px-3 py-2 text-end">{t('dansResultat')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {totaux.map(({ cote, colonne, avant, apres }) => (
                <tr key={colonne.nom}>
                  <th scope="row" className="px-3 py-2 text-start font-normal">
                    {t('totalCote', { colonne: colonne.description, cote: cote === 'gauche' ? t('premierJeu') : t('deuxiemeJeu') })}
                  </th>
                  <td className="px-3 py-2 text-end tabular-nums">{nombre(avant)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{nombre(apres)}</td>
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
  const t = useTranslations('sources.combiner.apercu')
  const { colonnes, lignes, tronque, diagnostic } = resultat
  return (
    <section className="space-y-3 rounded-lg border bg-background p-4" aria-labelledby="titre-apercu">
      <h2 id="titre-apercu" className="font-semibold">{t('titre')}</h2>
      <DiagnosticJointure diagnostic={diagnostic} />
      {lignes.length === 0 ? (
        <p role="status" className="text-sm">{t('aucuneLigne')}</p>
      ) : (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            {tronque ? t('tronque', { count: 20 }) : t('lignesResultat', { count: lignes.length })}
          </p>
          <div className="max-h-96 overflow-auto rounded-md border" tabIndex={0} role="region" aria-label={t('tableauPrevisualisation')}>
            <table className="w-full border-collapse text-start text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {afficherCorrespondances && <th scope="col" className="px-3 py-2 text-start">{t('correspondance')}</th>}
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
                        {ligne.correspondance ? t('trouvee') : t('sansCorrespondance')}
                      </td>
                    )}
                    {ligne.cellules.map((valeur, j) => (
                      <td key={colonnes[j].nom} className="max-w-72 break-words px-3 py-2 align-top">
                        {valeur ?? <span aria-label={t('valeurNulle')} className="text-muted-foreground">—</span>}
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
