/**
 * Aide de test du lot 4 : traductions réelles du namespace medicAssistArtefacts.
 *
 * `tests/setup.ts` mock next-intl avec `loadMessages(locale)`, qui ne connaît pas encore
 * le namespace (le lot 0 l'enregistre dans i18n/messages.ts). Ce mock local ajoute le
 * JSON du lot. Après la fusion du lot 0, il reste valable (il ne fait qu'ajouter).
 *
 * Usage en tête d'un fichier de test :
 *   vi.mock('next-intl', async importOriginal =>
 *     (await import('./_intl')).mockNextIntl(await importOriginal()))
 * Pour changer de langue : `langueTest.code = 'en'` avant le rendu.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Locale } from '@/i18n/config'

export const langueTest = { code: 'fr' as Locale }

const cache = new Map<string, Record<string, unknown>>()

export async function messagesTest(locale: Locale): Promise<Record<string, unknown>> {
  const cle = locale
  const deja = cache.get(cle)
  if (deja) return deja
  const { loadMessages } = await import('@/i18n/messages')
  const base = (await loadMessages(locale)) as unknown as Record<string, unknown>
  const brut = readFileSync(
    resolve(process.cwd(), 'messages', locale, 'medicAssistArtefacts.json'),
    'utf8'
  )
  const messages = { ...base, medicAssistArtefacts: JSON.parse(brut) }
  cache.set(cle, messages)
  return messages
}

export async function mockNextIntl(actual: typeof import('next-intl')) {
  const tous = {} as Record<string, Record<string, unknown>>
  for (const l of ['fr', 'en', 'es', 'zh', 'ar', 'hi'] as const) {
    try {
      tous[l] = await messagesTest(l)
    } catch {
      /* langue pas encore traduite : ignorée */
    }
  }
  const messagesCourants = () => tous[langueTest.code] ?? tous.fr
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({
        locale: langueTest.code,
        messages: messagesCourants() as never,
        namespace: namespace as never,
      }),
    useFormatter: () => actual.createFormatter({ locale: langueTest.code }),
    useLocale: () => langueTest.code,
    useMessages: () => messagesCourants(),
    useNow: () => new Date(),
    useTimeZone: () => undefined,
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  }
}
