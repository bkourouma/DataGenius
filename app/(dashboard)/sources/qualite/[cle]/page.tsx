import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { toIntlTag } from '@/i18n/config'
import { chargerQualite } from '@/lib/warehouse/qualite-admin'
import { messagesExecution } from '@/lib/warehouse/qualite'
import { Badge } from '@/components/ui/badge'
import { EnTetePage } from '@/components/ui/en-tete-page'
import { messageErreurLib } from '../../erreurs-lib'
import { FormulaireQualite, RelancerImport } from './formulaire'

export const dynamic = 'force-dynamic'

const variantesStatut = { publie: 'success', identique: 'success', echec: 'danger' } as const

/**
 * Les messages d'exécution de lib/warehouse/qualite.ts (indexés par code) sont traduits via
 * messageErreurLib (clés sources.erreursLib.exec*) : leur formulation complète diffère des motifs
 * courts de sources.synchro.echec.*, ce n'est donc pas le même texte.
 */
async function messagesExecutionTraduits(codes: (string | null)[]) {
  const uniques = Array.from(new Set(codes)).filter((code): code is string => !!code && Object.hasOwn(messagesExecution, code))
  const textes = await Promise.all(uniques.map(code => messageErreurLib(messagesExecution[code])))
  return new Map(uniques.map((code, i) => [code, textes[i]]))
}

export default async function QualiteImport({ params, searchParams }: {
  params: { cle: string }; searchParams: { etat?: string }
}) {
  if (!(await exigerAdminMedicAssist()).ok) redirect('/assistant')
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(params.cle)) notFound()
  const jeu = await chargerQualite(params.cle)
  if (!jeu) notFound()
  const [t, locale] = await Promise.all([getTranslations('sources.qualite.page'), getLocale()])
  const formatDate = new Intl.DateTimeFormat(toIntlTag(locale), { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
  const messagesCodes = await messagesExecutionTraduits(jeu.historique.map(ligne => ligne.code))
  const enRetard = jeu.derniereReussite && Date.now() - jeu.derniereReussite.getTime() > jeu.frequenceMinutes * 60_000
  const date = (valeur: Date | null) => valeur ? formatDate.format(valeur) + ' UTC' : '—'

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <EnTetePage
        retour={{ href: '/sources', libelle: t('retour') }}
        titre={t('titre', { titre: jeu.titre })}
        description={t('description')}
      />
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="text-base font-semibold">{t('fraicheur')}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">{t('dernierePublication')}</dt><dd>{date(jeu.publication)}</dd></div>
          <div><dt className="text-muted-foreground">{t('derniereVerification')}</dt><dd>{date(jeu.derniereReussite)}</dd></div>
          <div><dt className="text-muted-foreground">{t('frequence')}</dt><dd>{t('frequenceValeur', { minutes: jeu.frequenceMinutes })}</dd></div>
          <div><dt className="text-muted-foreground">{t('etat')}</dt><dd className="mt-0.5">{jeu.historique[0]?.statut === 'echec' ? <Badge variant="danger">{t('etatEchec')}</Badge> :
            !jeu.derniereReussite ? <Badge variant="outline">{t('etatAttente')}</Badge> : enRetard ? <Badge variant="warning">{t('etatRetard')}</Badge> : <Badge variant="success">{t('etatAJour')}</Badge>}</dd></div>
        </dl>
        <RelancerImport cle={jeu.cle} />
        {jeu.incrementalPossible && <Link href={'/sources/incremental/' + jeu.cle}
          className="block text-sm text-primary hover:underline">{t('incrementalLien')}</Link>}
      </section>
      {searchParams.etat === 'enregistre' && (
        <p role="status" className="flex items-center gap-2 rounded-md bg-success-soft p-3 text-sm text-success">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />{t('enregistre')}
        </p>
      )}
      <FormulaireQualite key={jeu.version} jeu={jeu} />
      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="text-base font-semibold">{t('historiqueTitre')}</h2>
        {jeu.historique.length === 0 ? <p className="text-sm text-muted-foreground">{t('historiqueVide')}</p> : (
          <div className="overflow-auto">
            <table className="w-full text-start text-sm">
              <thead className="border-b text-muted-foreground"><tr><th scope="col" className="py-2 pe-3 font-medium">{t('colDate')}</th><th scope="col" className="pe-3 font-medium">{t('colMode')}</th><th scope="col" className="pe-3 font-medium">{t('colResultat')}</th><th scope="col" className="pe-3 text-end font-medium">{t('colLues')}</th><th scope="col" className="text-end font-medium">{t('colRetenues')}</th></tr></thead>
              <tbody className="divide-y">
                {jeu.historique.map((ligne, index) => <tr key={index}>
                  <td className="py-2 pe-3">{date(ligne.verifieA)}</td>
                  <td className="pe-3">{ligne.modeLecture === 'delta' ? t('modeDelta') : ligne.modeLecture === 'reconciliation' ? t('modeReconciliation') : '—'}</td>
                  <td className="pe-3"><Badge variant={variantesStatut[ligne.statut]}>{t('statuts.' + ligne.statut)}</Badge>{ligne.code && messagesCodes.has(ligne.code) ? <span className="ms-2 text-muted-foreground">{messagesCodes.get(ligne.code)}</span> : null}</td>
                  <td className="pe-3 text-end">{ligne.lignesLues ?? '—'}</td><td className="text-end">{ligne.lignesValides ?? '—'}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="space-y-2 rounded-lg border bg-card p-5">
        <h2 className="text-base font-semibold">{t('dependantsTitre')}</h2>
        {jeu.dependances.length ? <ul className="list-disc ps-5 text-sm">{jeu.dependances.map(d => <li key={d.cle}>{d.titre}</li>)}</ul> :
          <p className="text-sm text-muted-foreground">{t('dependantsVide')}</p>}
      </section>
    </section>
  )
}
