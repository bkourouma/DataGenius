import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toIntlTag } from '@/i18n/config'
import { analyserFiltres, type ParametresBruts } from '@/lib/audit/filtres'
import { listerAudit } from '@/lib/audit/lecture'
import {
  ACTIONS_AUDIT,
  CONSERVATION_JOURS,
  EXPORT_MAX_LIGNES,
  FAMILLES_AUDIT,
  TYPES_CIBLE_AUDIT,
  cleTraductionAction,
  type FiltresAudit,
  type LigneAudit,
  type ResultatAudit,
} from '@/lib/audit/types'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'

export const dynamic = 'force-dynamic'

type ParamsPage = ParametresBruts

const FUSEAU_AFFICHE = 'UTC'
const CLASSE_SELECT =
  'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [@media(pointer:coarse)]:min-h-11'
const CLASSE_LIBELLE = 'text-sm font-medium'
const VARIANTE_RESULTAT: Record<ResultatAudit, 'success' | 'danger' | 'warning'> = {
  succes: 'success',
  echec: 'danger',
  refuse: 'warning',
}

const jourIso = (d?: Date) => (d ? d.toISOString().slice(0, 10) : undefined)

/** Paramètres d'URL équivalents aux filtres (sans la page), pour les liens et l'export. */
function parametresFiltres(filtres: FiltresAudit): URLSearchParams {
  const p = new URLSearchParams()
  const du = jourIso(filtres.depuis)
  const au = jourIso(filtres.jusqua)
  if (du) p.set('du', du)
  if (au) p.set('au', au)
  if (filtres.acteur) p.set('acteur', filtres.acteur)
  if (filtres.famille) p.set('famille', filtres.famille)
  if (filtres.action) p.set('action', filtres.action)
  if (filtres.cible) p.set('cible', filtres.cible)
  return p
}

function lienPage(filtres: FiltresAudit, page: number): string {
  const p = parametresFiltres(filtres)
  if (page > 1) p.set('page', String(page))
  const requete = p.toString()
  return requete ? `/journal?${requete}` : '/journal'
}

type Traduire = (cle: string, valeurs?: Record<string, string | number>) => string

function traduireOu(t: Traduire, cle: string, repli: string): string {
  try {
    return t(cle)
  } catch {
    return repli
  }
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams?: ParamsPage | Promise<ParamsPage>
}) {
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) redirect('/assistant')

  const params = (await searchParams) ?? {}
  const { filtres, page } = analyserFiltres(params)
  const [resultat, t, locale] = await Promise.all([listerAudit(filtres, page), getTranslations('journal'), getLocale()])
  const traduire = t as unknown as Traduire
  const formatDate = new Intl.DateTimeFormat(toIntlTag(locale), {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: FUSEAU_AFFICHE,
  })
  const filtresActifs = parametresFiltres(filtres)
  const lienExport = filtresActifs.toString() ? `/journal/export?${filtresActifs.toString()}` : '/journal/export'
  const pageCourante = Math.min(resultat.page, Math.max(resultat.pages, 1))

  const libelleAction = (action: string) => traduireOu(traduire, `actions.${cleTraductionAction(action)}`, action)
  const libelleCible = (l: LigneAudit) => {
    if (!l.cibleType) return '—'
    const type = (TYPES_CIBLE_AUDIT as readonly string[]).includes(l.cibleType)
      ? traduire(`cibles.${l.cibleType}`)
      : l.cibleType
    const precision = l.cibleLibelle || l.cibleId
    return precision ? `${type} · ${precision}` : type
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6 py-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{t('titre')}</h1>
        <p className="text-sm text-muted-foreground">{t('introduction')}</p>
        <p className="text-sm text-muted-foreground">{t('retention', { jours: CONSERVATION_JOURS })}</p>
      </header>

      <form method="get" action="/journal" className="space-y-4 rounded-lg border border-border bg-card p-4">
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold">{t('filtres.legende')}</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="filtre-du" className={CLASSE_LIBELLE}>{t('filtres.du')}</label>
              <Input id="filtre-du" name="du" type="date" defaultValue={jourIso(filtres.depuis)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="filtre-au" className={CLASSE_LIBELLE}>{t('filtres.au')}</label>
              <Input id="filtre-au" name="au" type="date" defaultValue={jourIso(filtres.jusqua)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="filtre-acteur" className={CLASSE_LIBELLE}>{t('filtres.acteur')}</label>
              <Input
                id="filtre-acteur"
                name="acteur"
                type="search"
                maxLength={100}
                defaultValue={filtres.acteur ?? ''}
                aria-describedby="filtre-acteur-aide"
              />
              <p id="filtre-acteur-aide" className="text-xs text-muted-foreground">{t('filtres.acteurAide')}</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="filtre-famille" className={CLASSE_LIBELLE}>{t('filtres.famille')}</label>
              <select id="filtre-famille" name="famille" defaultValue={filtres.famille ?? ''} className={CLASSE_SELECT}>
                <option value="">{t('filtres.toutes')}</option>
                {FAMILLES_AUDIT.map(f => <option key={f} value={f}>{t(`familles.${f}`)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="filtre-action" className={CLASSE_LIBELLE}>{t('filtres.action')}</label>
              <select id="filtre-action" name="action" defaultValue={filtres.action ?? ''} className={CLASSE_SELECT}>
                <option value="">{t('filtres.tous')}</option>
                {ACTIONS_AUDIT.map(a => <option key={a} value={a}>{libelleAction(a)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="filtre-cible" className={CLASSE_LIBELLE}>{t('filtres.cible')}</label>
              <Input id="filtre-cible" name="cible" type="search" maxLength={100} defaultValue={filtres.cible ?? ''} />
            </div>
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t('filtres.appliquer')}</Button>
          <Button asChild variant="outline"><Link href="/journal">{t('filtres.reinitialiser')}</Link></Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('pagination.total', { total: resultat.total })}</p>
        <div className="space-y-1 text-end">
          <Link href={lienExport} className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
            {t('export.lien')}
          </Link>
          <p className="text-xs text-muted-foreground">{t('export.mention', { max: EXPORT_MAX_LIGNES })}</p>
        </div>
      </div>

      {resultat.lignes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t('vide')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <caption className="p-3 text-start text-xs text-muted-foreground">
              {t('tableau.legende')} · {t('fuseau', { fuseau: FUSEAU_AFFICHE })}
            </caption>
            <thead className="bg-secondary">
              <tr>
                {(['date', 'acteur', 'action', 'cible', 'resultat', 'ip', 'details'] as const).map(c => (
                  <th key={c} scope="col" className="px-3 py-2 text-start font-semibold">{t(`colonnes.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultat.lignes.map(l => (
                <tr key={l.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-2">
                    <time dateTime={l.faitA.toISOString()}>{formatDate.format(l.faitA)}</time>
                  </td>
                  <td className="px-3 py-2">
                    {l.acteurId === null ? t('acteurInconnu') : (l.acteurNom ?? l.acteurId)}
                  </td>
                  <td className="px-3 py-2">{libelleAction(l.action)}</td>
                  <td className="px-3 py-2 break-words">{libelleCible(l)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={VARIANTE_RESULTAT[l.resultat] ?? 'outline'}>{t(`resultats.${l.resultat}`)}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2" dir="ltr">{l.ip ?? '—'}</td>
                  <td className="px-3 py-2">
                    {Object.keys(l.details ?? {}).length === 0 ? (
                      <span className="text-muted-foreground">{t('aucunDetail')}</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-primary">{t('detailsAfficher')}</summary>
                        <pre dir="ltr" className="mt-2 max-w-xs overflow-x-auto whitespace-pre-wrap break-words text-xs">
                          {JSON.stringify(l.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label={t('pagination.navigation')} className="flex flex-wrap items-center justify-between gap-3">
        {pageCourante > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={lienPage(filtres, pageCourante - 1)} rel="prev">{t('pagination.precedent')}</Link>
          </Button>
        ) : <span />}
        <p className="text-sm" aria-live="polite">
          {t('pagination.page', { page: pageCourante, pages: Math.max(resultat.pages, 1) })}
        </p>
        {pageCourante < resultat.pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={lienPage(filtres, pageCourante + 1)} rel="next">{t('pagination.suivant')}</Link>
          </Button>
        ) : <span />}
      </nav>
    </section>
  )
}
