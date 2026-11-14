'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('common.erreur')

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div role="alert" className="w-full max-w-md rounded-lg border bg-card p-6 text-start shadow-sm">
        <AlertTriangle className="mb-4 h-6 w-6 text-destructive" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">{t('titre')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('description')}</p>
        {error.digest && (
          <p className="mt-4 text-xs text-muted-foreground">
            {t('reference')} : <code dir="ltr" className="font-mono">{error.digest}</code>
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => reset()}>{t('reessayer')}</Button>
          <Button asChild variant="outline">
            <Link href="/">{t('accueil')}</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
