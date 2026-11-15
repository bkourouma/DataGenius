import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BookOpen, Search, X } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { EnTetePage, EtatVide } from '@/components/ui/en-tete-page'
import { Input } from '@/components/ui/input'
import { FormulaireComplement } from '@/components/glossaire/formulaire-complement'
import { listerGlossaire, type EntreeGlossaire } from '@/lib/glossaire/glossaire'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'

export const dynamic = 'force-dynamic'

type Parametres = { q?: string | string[] }
type Props = { searchParams?: Parametres | Promise<Parametres> }

type Traduire = (cle: string, valeurs?: Record<string, string>) => string

/** « Somme de montant_ht », « Rapport de a sur b » : le libellé vient des messages, jamais du SQL. */
function texteFormule(t: Traduire, formule: EntreeGlossaire['formule']): string {
  if (formule.agregat === 'rapport' && formule.colonne && formule.denominateur) {
    return t('agregats.rapport', { numerateur: formule.colonne, denominateur: formule.denominateur })
  }
  if (!formule.colonne) return t('agregats.nombreLignes')
  return t(`agregats.${formule.agregat === 'rapport' ? 'somme' : formule.agregat}`, { colonne: formule.colonne })
}

export default async function GlossairePage({ searchParams }: Props) {
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const parametres = (await searchParams) ?? {}
  const brut = Array.isArray(parametres.q) ? parametres.q[0] : parametres.q
  const recherche = (brut ?? '').trim().slice(0, 100)
  const { contexte } = acces
  const admin = contexte.roleName === 'TenantAdmin'
  const t = await getTranslations('glossaire.page')
  const traduire: Traduire = (cle, valeurs) => t(cle as never, valeurs as never)

  const visibles = await listerGlossaire(contexte, { recherche })
  const groupes = new Map<string, { libelle: string; entrees: EntreeGlossaire[] }>()
  for (const entree of visibles) {
    const groupe = groupes.get(entree.jeu.cle) ?? { libelle: entree.jeu.libelle, entrees: [] }
    groupe.entrees.push(entree)
    groupes.set(entree.jeu.cle, groupe)
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <EnTetePage titre={t('titre')} description={t('description')} />

      <form method="get" role="search" className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            type="search"
            name="q"
            defaultValue={recherche}
            maxLength={100}
            placeholder={t('recherche.placeholder')}
            aria-label={t('recherche.libelle')}
            icon={<Search aria-hidden />}
          />
        </div>
        <Button type="submit">{t('recherche.bouton')}</Button>
        {recherche && (
          <Link href="/glossaire" className={buttonVariants({ variant: 'ghost' })}>
            <X aria-hidden />{t('recherche.effacer')}
          </Link>
        )}
      </form>

      {!visibles.length && !recherche && (
        <EtatVide icone={<BookOpen />} titre={t('vide.aucunJeuTitre')}>{t('vide.aucunJeu')}</EtatVide>
      )}
      {!visibles.length && recherche && (
        <EtatVide icone={<Search />} titre={t('vide.aucunResultatTitre')}>{t('vide.aucunResultat', { q: recherche })}</EtatVide>
      )}

      {[...groupes.entries()].map(([cle, groupe]) => (
        <section key={cle} className="space-y-3" aria-labelledby={`jeu-${cle}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 id={`jeu-${cle}`} className="text-lg font-semibold">{groupe.libelle}</h2>
            <span className="text-xs text-muted-foreground">{t('compte', { count: groupe.entrees.length })}</span>
          </div>
          <ul className="space-y-3">
            {groupe.entrees.map(e => (
              <li key={e.ancre} id={e.ancre} className="scroll-mt-20 space-y-3 rounded-lg border bg-card p-4 text-start">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0 space-y-0.5">
                    <h3 className="text-base font-semibold">{e.indicateur.libelle}</h3>
                    <p className="text-xs text-muted-foreground">{t('jeuOrigine')} : {e.jeu.libelle}</p>
                  </div>
                  {e.unite && <Badge variant="outline">{e.unite}</Badge>}
                </div>
                <p className="text-pretty text-sm">{e.definition}</p>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                  <dt className="font-medium text-muted-foreground">{t('formule')}</dt>
                  <dd className="min-w-0 space-y-1">
                    <span className="font-mono text-xs [overflow-wrap:anywhere]" dir="auto">{texteFormule(traduire, e.formule)}</span>
                    {e.formule.regles.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {t('conditions')} : {e.formule.regles.join(' ; ')}
                      </span>
                    )}
                  </dd>
                  {e.synonymes.length > 0 && (
                    <>
                      <dt className="font-medium text-muted-foreground">{t('synonymes')}</dt>
                      <dd>
                        <ul className="flex flex-wrap gap-1.5">
                          {e.synonymes.map(s => <li key={s}><Badge variant="secondary">{s}</Badge></li>)}
                        </ul>
                      </dd>
                    </>
                  )}
                </dl>
                {admin && (
                  <FormulaireComplement jeu={e.jeu.cle} indicateur={e.indicateur.cle} definition={e.complement} synonymes={e.synonymes} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  )
}
