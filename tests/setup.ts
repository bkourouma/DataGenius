import '@testing-library/jest-dom'

// Garde-fou e-mail : aucun test ne doit pouvoir joindre un vrai relais SMTP, meme si le
// .env local en contient un. Un test qui verifie l'envoi fournit sa propre configuration
// ou simule '@/lib/mail/transport'.
process.env.SMTP_HOST = ''
process.env.SMTP_USER = ''
process.env.SMTP_PASSWORD = ''

// Mock Next.js modules
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn(),
    getAll: vi.fn(),
    has: vi.fn(),
    keys: vi.fn(),
    values: vi.fn(),
    entries: vi.fn(),
    forEach: vi.fn(),
    toString: vi.fn(),
  }),
  usePathname: () => '/',
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { 
      user: { 
        id: 'test-user-id', 
        email: 'test@example.com',
        name: 'Test User'
      } 
    },
    status: 'authenticated',
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

// Traductions : les composants lisent les messages français sans provider.
// createTranslator/createFormatter viennent de next-intl (moteur ICU réel),
// donc les tests continuent d'asserter sur les textes français.
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>()
  const { loadMessages } = await import('@/i18n/messages')
  const messages = await loadMessages('fr')
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'fr', messages, namespace: namespace as never }),
    useFormatter: () => actual.createFormatter({ locale: 'fr', timeZone: 'UTC' }),
    useLocale: () => 'fr',
    useMessages: () => messages,
    useNow: () => new Date(),
    useTimeZone: () => undefined,
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  }
})

vi.mock('next-intl/server', async () => {
  const actual = await import('next-intl')
  const { loadMessages } = await import('@/i18n/messages')
  const messages = await loadMessages('fr')
  return {
    getTranslations: async (options?: string | { namespace?: string }) => {
      const namespace = typeof options === 'string' ? options : options?.namespace
      return actual.createTranslator({ locale: 'fr', messages, namespace: namespace as never })
    },
    getFormatter: async () => actual.createFormatter({ locale: 'fr', timeZone: 'UTC' }),
    getLocale: async () => 'fr',
    getMessages: async () => messages,
    getNow: async () => new Date(),
    getTimeZone: async () => undefined,
  }
})

// Mock fetch globally
global.fetch = vi.fn()

// Mock Web APIs
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
})

// jsdom n'implemente ni la capture de pointeur ni `scrollIntoView`. Les
// composants Radix (listes deroulantes, menus, onglets) s'en servent des
// l'ouverture : sans ces trois fonctions, aucun d'eux ne peut etre teste.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// Mock IntersectionObserver
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
})

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn(),
    readText: vi.fn(),
  },
  writable: true,
})

// Mock Web Share API
Object.defineProperty(navigator, 'share', {
  value: vi.fn(),
  writable: true,
})

// Mock URL.createObjectURL
Object.defineProperty(URL, 'createObjectURL', {
  value: vi.fn(() => 'mock-object-url'),
  writable: true,
})

Object.defineProperty(URL, 'revokeObjectURL', {
  value: vi.fn(),
  writable: true,
})

// Setup cleanup after each test
afterEach(() => {
  vi.clearAllMocks()
})

