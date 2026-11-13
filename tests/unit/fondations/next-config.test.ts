import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { pathToRegexp } = require('next/dist/compiled/path-to-regexp') as {
  pathToRegexp: (source: string) => RegExp
}

type Regle = { source: string; headers: { key: string; value: string }[] }
const racine = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const script = "const c=require('./next.config.js');c.headers().then(h=>console.log(JSON.stringify({output:c.output,experimental:c.experimental,headers:h})))"

// Processus séparé : le plugin next-intl ne se charge pas dans l'environnement jsdom du projet unit,
// et l'environnement du processus de test reste intact.
function charger(nextauthUrl?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (nextauthUrl === undefined) delete env.NEXTAUTH_URL
  else env.NEXTAUTH_URL = nextauthUrl
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: racine, env, encoding: 'utf8' })) as {
    output: string
    experimental: { instrumentationHook: boolean; outputFileTracingIncludes: Record<string, string[]> }
    headers: Regle[]
  }
}
const ciblant = (liste: Regle[], chemin: string) => liste.filter(r => pathToRegexp(r.source).test(chemin))
const valeurs = (liste: Regle[], cle: string) => liste.flatMap(r => r.headers.filter(h => h.key === cle).map(h => h.value))

describe('next.config.js', { timeout: 30_000 }, () => {
  it('produit une sortie autonome avec instrumentation et polices PDF tracées', () => {
    const c = charger('http://localhost:3120')
    expect(c.output).toBe('standalone')
    expect(c.experimental.instrumentationHook).toBe(true)
    expect(c.experimental.outputFileTracingIncludes['/*']).toContain('./node_modules/pdfmake/fonts/Roboto/*')
  })

  it('pose les en-têtes de sécurité sur une route normale, sans doublon', () => {
    const { headers } = charger('http://localhost:3120')
    const touchees = ciblant(headers, '/analyses/abc')
    expect(valeurs(touchees, 'X-Frame-Options')).toEqual(['DENY'])
    expect(valeurs(touchees, 'Content-Security-Policy')).toEqual(["frame-ancestors 'none'"])
    expect(valeurs(touchees, 'X-Content-Type-Options')).toEqual(['nosniff'])
    expect(valeurs(touchees, 'Referrer-Policy')).toEqual(['strict-origin-when-cross-origin'])
    expect(valeurs(touchees, 'Permissions-Policy')).toEqual(['camera=(), geolocation=(), microphone=(self)'])
    expect(ciblant(headers, '/')).toHaveLength(1)
  })

  it('ne pose HSTS que si NEXTAUTH_URL est en https', () => {
    expect(valeurs(charger('http://localhost:3120').headers, 'Strict-Transport-Security')).toEqual([])
    expect(valeurs(charger().headers, 'Strict-Transport-Security')).toEqual([])
    const https = charger('https://data.example.com').headers
    expect(valeurs(ciblant(https, '/'), 'Strict-Transport-Security')).toEqual(['max-age=31536000; includeSubDomains'])
  })

  it("laisse la route d'intégration poser son propre CSP", () => {
    const touchees = ciblant(charger('https://data.example.com').headers, '/api/v1/integration/tableau')
    expect(touchees.length).toBeGreaterThan(0)
    expect(valeurs(touchees, 'X-Frame-Options')).toEqual([])
    expect(valeurs(touchees, 'Content-Security-Policy')).toEqual([])
    expect(valeurs(touchees, 'Referrer-Policy')).toEqual([])
    expect(valeurs(touchees, 'X-Content-Type-Options')).toEqual(['nosniff'])
    expect(valeurs(touchees, 'Strict-Transport-Security')).toHaveLength(1)
  })

  it("conserve la règle de la page d'autorisation sans valeurs divergentes", () => {
    const touchees = ciblant(charger('http://localhost:3120').headers, '/integration/autoriser')
    expect(valeurs(touchees, 'Content-Security-Policy')).toEqual(["frame-ancestors 'none'"])
    expect(valeurs(touchees, 'Referrer-Policy')).toEqual(['no-referrer'])
    expect(valeurs(touchees, 'X-Frame-Options')).toEqual([])
  })
})
