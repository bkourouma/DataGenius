import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Database } from 'lucide-react'
import { FormulaireDemande } from './formulaire'

export async function generateMetadata() {
  const t = await getTranslations('ecrans.motDePasseOublie')
  return { title: t('metaTitre'), robots: { index: false, follow: false } }
}

export default async function MotDePasseOublie() {
  const t = await getTranslations('ecrans.motDePasseOublie')
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/50 px-4">
      <section className="w-full max-w-sm rounded-xl border bg-card p-7 shadow-sm">
        <div className="mb-5 flex items-center gap-2 font-semibold">
          <Database size={20} className="text-primary" aria-hidden />
          Data Genius
        </div>
        <h1 className="mb-2 text-2xl font-bold">{t('titre')}</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          {t('intro')}
        </p>
        <FormulaireDemande />
        <p className="mt-4 text-sm text-muted-foreground">
          {t('entreprise')}
        </p>
        <Link href="/login" className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline">
          {t('retour')}
        </Link>
      </section>
    </main>
  )
}
