import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type Regle = { source: string; destination?: string; permanent?: boolean; headers?: Array<{ key: string }> }

// next.config.js est chargé dans un processus Node séparé : le plugin next-intl
// s'appuie sur __filename, indisponible dans l'environnement jsdom des tests.
function chargerConfig(): { redirects: Regle[]; headers: Regle[] } {
  const racine = path.resolve(__dirname, '../../..')
  const script =
    "const c=require('./next.config.js');Promise.all([c.redirects(),c.headers()])" +
    '.then(([redirects,headers])=>process.stdout.write(JSON.stringify({redirects,headers})))'
  const sortie = execFileSync(process.execPath, ['-e', script], { cwd: racine, encoding: 'utf8', timeout: 60_000 })
  return JSON.parse(sortie)
}

describe('redirections /medic-assist vers /assistant (next.config.js)', () => {
  const config = chargerConfig()

  it('déclare deux redirections permanentes, sans toucher aux routes API', () => {
    expect(config.redirects).toEqual([
      { source: '/medic-assist', destination: '/assistant', permanent: true },
      { source: '/medic-assist/:path*', destination: '/assistant/:path*', permanent: true },
      { source: '/dashboard/admin/medic-assist', destination: '/dashboard/admin/assistant', permanent: true },
      { source: '/dashboard/admin/medic-assist/:path*', destination: '/dashboard/admin/assistant/:path*', permanent: true },
    ])
    expect(config.redirects.some((r) => r.source.startsWith('/api'))).toBe(false)
  })

  it('conserve les en-têtes de sécurité existants', () => {
    const cles = config.headers.flatMap((h) => (h.headers ?? []).map((e) => e.key))
    expect(cles).toContain('X-Frame-Options')
    expect(cles).toContain('X-Content-Type-Options')
  })
})
