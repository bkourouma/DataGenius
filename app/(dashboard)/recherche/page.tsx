import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BookOpen, ChevronRight, Database, LayoutDashboard, LineChart, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EnTetePage, EtatVide } from '@/components/ui/en-tete-page'
import { Input } from '@/components/ui/input'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { rechercher, requeteValide, type TypeResultat } from '@/lib/recherche/rechercher'

export const dynamic = 'force-dynamic'

type Parametres = { q?: string | string[] }
type Props = { searchParams?: Parametres | Promise<Parametres> }

const TYPES: { type: TypeResultat; icone: typeof Search }[] = [
  { type: 'tableau', icone: LayoutDashboard },
  { type: 'analyse', icone: LineChart },
  { type: 'glossaire', icone: BookOpen },
  { type: 'source', icone: Database },
]

export default async function RecherchePage({ searchParams }: Props) {
  const acces = await exigerMedicAssist()
  if (!acces.ok) redirect('/login')
  const parametres = (await searchParams) ?? {}
  const brut = Array.isArray(parametres.q) ? parametres.q[0] : parametres.q
  const q = (brut ?? '').trim().slice(0, 200)
  const t = await getTranslations('glossaire.recherche')

  const valide = requeteValide(q)
  const resultats = valide ? await rechercher(acces.contexte, valide) : []

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <EnTetePage titre={t('titre')} description={t('description')} />

      <form method="get" role="search" className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder={t('placeholder')}
            aria-label={t('champ')}
            icon={<Search aria-hidden />}
          />
        </div>
        <Button type="submit">{t('bouton')}</Button>
      </form>

      {!q && <p className="text-sm text-muted-foreground">{t('accueil')}</p>}
      {q && !valide && <p role="status" className="text-sm text-muted-foreground">{t('tropCourt')}</p>}
      {valide && !resultats.length && (
        <EtatVide icone={<Search />} titre={t('videTitre')}>{t('vide', { q: valide })}</EtatVide>
      )}

      {TYPES.map(({ type, icone: Icone }) => {
        const groupe = resultats.filter(r => r.type === type)
        if (!groupe.length) return null
        return (
          <section key={type} className="space-y-3" aria-labelledby={`groupe-${type}`}>
            <h2 id={`groupe-${type}`} className="flex items-center gap-2 text-lg font-semibold">
              <Icone className="size-5 text-muted-foreground" aria-hidden />
              {t(`groupes.${type}`)}
              <span className="text-sm font-normal text-muted-foreground">{t('compte', { count: groupe.length })}</span>
            </h2>
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {groupe.map(r => (
                <li key={`${r.type}-${r.id}`}>
                  <Link
                    href={r.href}
                    className="flex items-center gap-3 px-4 py-3 text-start hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.titre}</span>
                      {r.detail && <span className="block truncate text-sm text-muted-foreground">{r.detail}</span>}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </section>
  )
}
