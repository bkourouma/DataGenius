import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { Toaster } from 'sonner'
import { getDirection } from '@/i18n/config'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Data Genius',
  description: 'Analysez vos données et créez des rapports par la conversation.',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  const dir = getDirection(locale)
  return (
    <html lang={locale} dir={dir}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
          <Toaster dir={dir} />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}

