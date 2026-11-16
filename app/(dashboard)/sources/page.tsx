import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { etatEntrepot } from '@/lib/warehouse/synchronisation'
import Link from 'next/link'
import { Combine, Database, FileSpreadsheet, Globe, Server, ShieldCheck } from 'lucide-react'
import { listerCombinaisons } from '@/lib/warehouse/combinaisons-admin'
import { dependancesJeu, listerSources } from '@/lib/warehouse/sources-admin'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { EnTetePage, EtatVide } from '@/components/ui/en-tete-page'
import { toIntlTag } from '@/i18n/config'
import { BandeauEtatWorker } from '@/components/etat-worker/bandeau-etat-worker'
import { FormulaireActualiser } from './formulaires'
import { FormulaireGestionJeu, FormulaireSupprimerCombinaison } from './formulaires-gestion'
import { BoutonAjouterSource } from './ajouter-source'
import { FrequenceDialogue } from './frequence-dialogue'

export const dynamic = 'force-dynamic'

const icones = { postgresql: Database, mysql: Server, rest: Globe, fichier: FileSpreadsheet }
const lienDiscret = 'text-sm font-medium text-primary hover:underline'

export default async function Sources() {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) redirect('/assistant')
  const t = await getTranslations('sources.page')
  const tType = await getTranslations('sources.typeSource')
  const tag = toIntlTag(await getLocale())
  const date = new Intl.DateTimeFormat(tag, { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
  const nombre = new Intl.NumberFormat(tag)
  const [jeux, sources, combinaisons] = await Promise.all([
    etatEntrepot().catch(() => null), listerSources().catch(() => null),
    listerCombinaisons().catch(() => null),
  ])
  const dependances = new Map(await Promise.all([
    ...(jeux ?? []).filter(j => j.modifiable).map(j => j.cle),
    ...(combinaisons ?? []).map(c => c.cle),
  ].map(async cle => [cle, await dependancesJeu(cle).catch(() => null)] as const)))

  return (
    <section className="mx-auto max-w-4xl space-y-8">
      <BandeauEtatWorker />
      <EnTetePage
        titre={t('titre')}
        description={t('description')}
        actions={<>
          <Link href="/sources/droits" className={buttonVariants({ variant: 'outline' })}>
            <ShieldCheck className="size-4" aria-hidden />{t('droits')}
          </Link>
          <BoutonAjouterSource />
        </>}
      />

      {/* Sans aucune source, l'etat vide « Aucune source connectee » suffit a guider. */}
      {sources?.length !== 0 && <section aria-labelledby="titre-imports" className="space-y-3">
        <h2 id="titre-imports" className="text-lg font-semibold">{t('importsTitre')}</h2>
        {(jeux === null || sources === null) && <p role="status" className="text-sm">{t('entrepotIndisponible')}</p>}
        {jeux?.length === 0 && <p role="status" className="text-sm">{t('ajoutezSource')}</p>}
        <ul className="space-y-3">
          {jeux?.map(({ cle, titre, source, frequence, modifiable, etat }) => (
            <li key={cle} className="space-y-4 rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <h3 className="font-semibold">{titre}</h3>
                  <p className="text-sm text-muted-foreground"><span className="font-mono text-xs">{source}</span> · {t('frequenceToutes', { frequence })}</p>
                </div>
                {etat?.statut === 'echec' ? <Badge variant="danger">{t('statutEchec')}</Badge>
                  : etat?.statut === 'publie' ? <Badge variant="success">{t('statutPublie')}</Badge>
                  : etat?.statut === 'identique' ? <Badge variant="success">{t('statutAJour')}</Badge>
                  : <Badge variant="warning">{t('statutAttente')}</Badge>}
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-muted-foreground">{t('dernierePublication')}</dt><dd className="font-medium">{etat?.publie_a ? date.format(etat.publie_a) + ' UTC' : t('statutAttente')}</dd></div>
                <div><dt className="text-muted-foreground">{t('lignesPubliees')}</dt><dd className="font-medium tabular-nums">{etat?.lignes == null ? '—' : nombre.format(Number(etat.lignes))}</dd></div>
                <div><dt className="text-muted-foreground">{t('derniereVerification')}</dt><dd className="font-medium">{etat?.verifie_a ? date.format(etat.verifie_a) + ' UTC' : '—'}</dd></div>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <FormulaireActualiser cle={cle} titre={titre} />
                {modifiable && <div className="flex flex-wrap items-center gap-3">
                  <FrequenceDialogue cle={cle} titre={titre} frequence={frequence} />
                  <LienCatalogue cle={cle} libelle={t('catalogue')} sr={t('catalogueSr', { titre })} />
                  <Link href={'/sources/qualite/' + cle} className={lienDiscret} prefetch={false}>
                    {t('qualite')}<span className="sr-only">{' '}{t('qualiteSr', { titre })}</span>
                  </Link>
                </div>}
              </div>
              {modifiable && <FormulaireGestionJeu cle={cle} titre={titre} dependances={dependances.get(cle) ?? null} />}
            </li>
          ))}
        </ul>
      </section>}

      <section aria-labelledby="titre-sources" className="space-y-3">
        <h2 id="titre-sources" className="text-lg font-semibold">{t('sourcesConnectees')}</h2>
        {sources?.length ? (
          <ul className="divide-y rounded-lg border bg-card">
            {sources.map(source => {
              const Icone = icones[source.type]
              return (
                <li key={source.id} className="flex flex-wrap items-center gap-3 p-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground" aria-hidden><Icone className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{source.titre}</p>
                    <p className="truncate text-sm text-muted-foreground">{tType(source.type)} · <span className="font-mono text-xs">{source.type === 'fichier' ? source.base : source.hote}</span></p>
                  </div>
                  <Link className={lienDiscret} href={'/sources/' + source.id} prefetch={false}>
                    {t('explorer')}<span className="sr-only">{' '}{t(source.type === 'fichier' ? 'explorerFichier' : source.type === 'rest' ? 'explorerRest' : 'explorerBase', { titre: source.titre })}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : sources === null ? null : (
          <EtatVide icone={<Database />} titre={t('aucuneSource')}
            action={<BoutonAjouterSource variant="outline" />}>
            {t('aucuneSourceAide')}
          </EtatVide>
        )}
      </section>

      <section id="combinaisons" aria-labelledby="titre-combinaisons" className="scroll-mt-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="titre-combinaisons" className="text-lg font-semibold">{t('jeuxCombines')}</h2>
          <Link href="/sources/combiner" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Combine className="size-4" aria-hidden />{t('combiner')}
          </Link>
        </div>
        {combinaisons === null && <p role="status" className="text-sm">{t('combinesIndisponibles')}</p>}
        {combinaisons?.length === 0 && (
          <EtatVide icone={<Combine />} titre={t('aucunCombine')}
            action={<Link href="/sources/combiner" className={buttonVariants({ variant: 'outline' })}>{t('combiner')}</Link>}>
            {t('aucunCombineAide')}
          </EtatVide>
        )}
        {!!combinaisons?.length && (
          <ul className="divide-y rounded-lg border bg-card">
            {combinaisons.map(jeu => (
              <li key={jeu.cle} className="space-y-1 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{jeu.titre}</h3>
                  <div className="flex flex-wrap gap-3">
                    <Link href={'/sources/combiner/' + jeu.cle} className={lienDiscret} prefetch={false}>
                      {t('modifier')}<span className="sr-only">{' '}{jeu.titre}</span>
                    </Link>
                    {jeu.disponible && <LienCatalogue cle={jeu.cle} libelle={t('catalogue')} sr={t('catalogueSr', { titre: jeu.titre })} />}
                  </div>
                </div>
                <p className="font-mono text-xs text-muted-foreground">{jeu.gauche} + {jeu.droite}</p>
                <p className="text-sm text-muted-foreground">
                  {t('resumeCombinaison', { type: jeu.type === 'gauche' ? t('typeGauche') : t('typeInterne'), liens: jeu.liens, colonnes: jeu.colonnes })}
                </p>
                {!jeu.disponible && <p className="text-sm text-destructive">{t('combinaisonIndisponible')}</p>}
                <FormulaireSupprimerCombinaison cle={jeu.cle} titre={jeu.titre} dependances={dependances.get(jeu.cle) ?? null} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}

function LienCatalogue({ cle, libelle, sr }: { cle: string; libelle: string; sr: string }) {
  return <Link href={'/sources/catalogue/' + cle} className={lienDiscret} prefetch={false}>
    {libelle}<span className="sr-only">{' '}{sr}</span>
  </Link>
}
