import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { FileQuestion } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default async function NotFound() {
  const t = await getTranslations('common.erreur')

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-start shadow-sm">
        <FileQuestion className="mb-4 h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">{t('introuvableTitre')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('introuvableDescription')}</p>
        <div className="mt-6">
          <Button asChild>
            <Link href="/">{t('accueil')}</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
