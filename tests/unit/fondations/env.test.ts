import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErreurEnvironnement, verifierEnvironnement } from '@/lib/env'

const valide = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  NEXTAUTH_SECRET: 'x'.repeat(32),
  NEXTAUTH_URL: 'http://localhost:3000',
}

function attraper(env: Record<string, string | undefined>, contexte: 'web' | 'worker' = 'web') {
  try {
    verifierEnvironnement(contexte, env)
  } catch (e) {
    return e as ErreurEnvironnement
  }
  throw new Error('aucune erreur levée')
}

afterEach(() => vi.restoreAllMocks())

describe('verifierEnvironnement', () => {
  it('liste toutes les variables obligatoires manquantes', () => {
    const e = attraper({})
    expect(e).toBeInstanceOf(ErreurEnvironnement)
    expect(e.variables).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL'])
    )
    for (const nom of e.variables) expect(e.message).toContain(nom)
  })

  it('nomme NEXTAUTH_SECRET quand il manque', () => {
    const e = attraper({ ...valide, NEXTAUTH_SECRET: undefined })
    expect(e.message).toContain('NEXTAUTH_SECRET')
  })

  it("n'affiche jamais la valeur d'un secret trop court", () => {
    const e = attraper({ ...valide, NEXTAUTH_SECRET: 'court-secret-123' })
    expect(e.message).toContain('NEXTAUTH_SECRET : trop court (32 caractères minimum)')
    expect(e.message).not.toContain('court-secret-123')
  })

  it('refuse un SMTP_PORT invalide avec SMTP_HOST', () => {
    const e = attraper({ ...valide, SMTP_HOST: 'smtp.exemple.org', SMTP_PORT: '70000' })
    expect(e.variables).toEqual(['SMTP_PORT'])
    expect(attraper({ ...valide, SMTP_HOST: 'h', SMTP_PORT: 'abc' }).variables).toEqual([
      'SMTP_PORT',
    ])
  })

  it("refuse une clé source non hexadécimale sans l'afficher", () => {
    const e = attraper({ ...valide, DATAGENIUS_SOURCE_KEY: 'zz'.repeat(32) })
    expect(e.variables).toEqual(['DATAGENIUS_SOURCE_KEY'])
    expect(e.message).not.toContain('zzzz')
  })

  it('traite une chaîne vide comme absente pour les facultatives', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      verifierEnvironnement('web', { ...valide, SMTP_PORT: '', DATAGENIUS_SOURCE_KEY: '' })
    ).not.toThrow()
  })

  it('contexte worker : seule DATABASE_URL est obligatoire', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      verifierEnvironnement('worker', { DATABASE_URL: valide.DATABASE_URL })
    ).not.toThrow()
    expect(attraper({}, 'worker').variables).toEqual(['DATABASE_URL'])
  })

  it('cas valide : renvoie les valeurs sans lever', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = verifierEnvironnement('web', { ...valide, SMTP_HOST: 'h', SMTP_PORT: '587' })
    expect(env.NEXTAUTH_URL).toBe(valide.NEXTAUTH_URL)
    expect(env.SMTP_PORT).toBe('587')
  })

  it('journalise les facultatives manquantes', () => {
    const avert = vi.spyOn(console, 'warn').mockImplementation(() => {})
    verifierEnvironnement('web', valide)
    const messages = avert.mock.calls.map((c) => JSON.parse(c[0] as string).message as string)
    expect(messages).toEqual(
      expect.arrayContaining([
        'SMTP absent : les e-mails ne partiront pas',
        expect.stringContaining('DATAGENIUS_SOURCE_KEY'),
        expect.stringContaining('DATAGENIUS_WAREHOUSE_READ_URL'),
        expect.stringContaining('JETON_TACHES_PLANIFIEES'),
        expect.stringContaining('clé IA'),
      ])
    )
  })

  it("ne journalise pas l'absence de clé IA si une clé existe", () => {
    const avert = vi.spyOn(console, 'warn').mockImplementation(() => {})
    verifierEnvironnement('web', { ...valide, ANTHROPIC_API_KEY: 'sk-test' })
    const messages = avert.mock.calls.map((c) => c[0] as string).join('\n')
    expect(messages).not.toContain('clé IA')
  })

  it('valide DATAGENIUS_PROXY_DE_CONFIANCE sans afficher la valeur', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      verifierEnvironnement('web', { ...valide, DATAGENIUS_PROXY_DE_CONFIANCE: '1' })
    ).not.toThrow()
    for (const mauvaise of ['abc', '-1', '11', '1.5']) {
      const e = attraper({ ...valide, DATAGENIUS_PROXY_DE_CONFIANCE: mauvaise })
      expect(e.variables).toEqual(['DATAGENIUS_PROXY_DE_CONFIANCE'])
      expect(e.message).not.toContain(mauvaise === 'abc' ? 'abc' : `: ${mauvaise}`)
    }
  })

  it('refuse SMTP_SECURE, APP_URL et NEXT_PUBLIC_TIMEZONE invalides', () => {
    expect(attraper({ ...valide, SMTP_SECURE: 'oui' }).variables).toEqual(['SMTP_SECURE'])
    expect(attraper({ ...valide, APP_URL: 'ftp://x' }).variables).toEqual(['APP_URL'])
    expect(attraper({ ...valide, NEXT_PUBLIC_TIMEZONE: 'Mars/Olympus' }).variables).toEqual([
      'NEXT_PUBLIC_TIMEZONE',
    ])
  })

  it('accepte les variables facultatives documentées', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      verifierEnvironnement('worker', {
        DATABASE_URL: valide.DATABASE_URL,
        SMTP_SECURE: 'true',
        APP_URL: 'https://datagenius.example.com',
        UPLOAD_DIR: '/data/uploads',
        NEXT_PUBLIC_TIMEZONE: 'Africa/Abidjan',
        DATAGENIUS_EMBED_ORIGINS: 'https://portail.example',
        DATAGENIUS_REST_ORIGINES_PRIVEES: 'https://api.interne.example',
        DATAGENIUS_CATALOGUE: 'config/demo.json',
      })
    ).not.toThrow()
  })
})
