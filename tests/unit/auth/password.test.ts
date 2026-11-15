import { randomBytes, scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { doitRehacher, hashPassword, verifierFauxMotDePasse, verifyPassword } from '@/lib/auth/password'

function ancienHash(motDePasse: string) {
  const sel = randomBytes(16).toString('hex')
  return [sel, scryptSync(motDePasse, sel, 64).toString('hex')].join('.')
}

describe('mots de passe', () => {
  it('produit le format versionné et des hachages distincts', async () => {
    const [a, b] = await Promise.all([hashPassword('correct horse battery'), hashPassword('correct horse battery')])
    expect(a).toMatch(/^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/)
    expect(a).not.toBe(b)
    expect(doitRehacher(a)).toBe(false)
  }, 30_000)

  it('vérifie le nouveau format et refuse un mauvais mot de passe', async () => {
    const hash = await hashPassword('secret-12345678')
    expect(await verifyPassword('secret-12345678', hash)).toBe(true)
    expect(await verifyPassword('autre-secret-123', hash)).toBe(false)
  }, 30_000)

  it('vérifie l’ancien format et demande son rehachage', async () => {
    const hash = ancienHash('ancien-secret-1')
    expect(await verifyPassword('ancien-secret-1', hash)).toBe(true)
    expect(await verifyPassword('mauvais', hash)).toBe(false)
    expect(doitRehacher(hash)).toBe(true)
  })

  it('renvoie false sans exception sur un format invalide ou hors bornes', async () => {
    const sel = 'a'.repeat(32)
    const digest = 'b'.repeat(128)
    for (const hash of [
      '', 'x', 'a.b', `${sel}.${digest}.extra`, `scrypt$131072$8$1$${sel}`,
      `scrypt$131071$8$1$${sel}$${digest}`, `scrypt$${2 ** 21}$8$1$${sel}$${digest}`,
      `scrypt$8192$8$1$${sel}$${digest}`, `scrypt$131072$99$1$${sel}$${digest}`,
      `scrypt$131072$8$99$${sel}$${digest}`, `scrypt$131072$8$1$zz$${digest}`,
      `scrypt$131072$8$1$${sel}$${'b'.repeat(127)}`, `scrypt$abc$8$1$${sel}$${digest}`,
    ]) {
      expect(await verifyPassword('x', hash)).toBe(false)
      expect(doitRehacher(hash)).toBe(true)
    }
  })

  it('refuse sans calcul un hachage plus coûteux que le coût actuel (N=2^20, r=16, p=4)', async () => {
    const sel = 'a'.repeat(32)
    const digest = 'b'.repeat(128)
    for (const hash of [
      `scrypt${2 ** 20}$16$4${sel}${digest}`, `scrypt${2 ** 20}$8$1${sel}${digest}`,
      `scrypt$131072$16$1${sel}${digest}`, `scrypt$131072$8$4${sel}${digest}`,
    ]) {
      const debut = Date.now()
      expect(await verifyPassword('x', hash)).toBe(false)
      // Un calcul à N=2^20 durerait plusieurs secondes : un refus immédiat prouve l'absence de calcul.
      expect(Date.now() - debut).toBeLessThan(200)
    }
  })

  it('demande un rehachage si les paramètres sont inférieurs aux actuels', () => {
    expect(doitRehacher(`scrypt$65536$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`)).toBe(true)
  })

  it('le faux hachage se calcule sans erreur', async () => {
    await expect(verifierFauxMotDePasse('quelconque')).resolves.toBeUndefined()
  }, 30_000)
})
