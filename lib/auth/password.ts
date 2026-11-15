import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// Paramètres actuels (nouveau format) : scrypt$<N>$<r>$<p>$<sel>$<hash>.
const N_ACTUEL = 2 ** 17
const R_ACTUEL = 8
const P_ACTUEL = 1
const TAILLE_SEL = 16
const TAILLE_HASH = 64
// Ancien format : <sel 32 hex>.<hash 128 hex>, N=16384, r=8, p=1.
const ANCIEN = { N: 16384, r: 8, p: 1 }
// Un hachage stocké ne doit jamais coûter plus que le coût actuel (hash corrompu ou falsifié :
// pas de calcul). L'ancien format a ses propres paramètres fixes (ANCIEN).
const N_MIN = 2 ** 14
const N_MAX = N_ACTUEL
const R_MAX = R_ACTUEL
const P_MAX = P_ACTUEL
const SEL_FAUX = Buffer.from('datagenius-faux-sel')

function deriver(motDePasse: string, sel: Buffer, longueur: number, N: number, r: number, p: number) {
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r + 16 * 1024 * 1024 }
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(motDePasse, sel, longueur, options, (erreur, cle) => erreur ? reject(erreur) : resolve(cle))
  })
}

export async function hashPassword(motDePasse: string): Promise<string> {
  const sel = randomBytes(TAILLE_SEL)
  const hash = await deriver(motDePasse, sel, TAILLE_HASH, N_ACTUEL, R_ACTUEL, P_ACTUEL)
  return ['scrypt', N_ACTUEL, R_ACTUEL, P_ACTUEL, sel.toString('hex'), hash.toString('hex')].join('$')
}

type Decode = { N: number, r: number, p: number, sel: Buffer, hash: Buffer, ancien: boolean }

function decoder(stocke: string): Decode | null {
  if (typeof stocke !== 'string' || stocke.length > 512) return null
  if (stocke.startsWith('scrypt$')) {
    const morceaux = stocke.split('$')
    if (morceaux.length !== 6) return null
    const [, n, r, p, sel, hash] = morceaux
    if (!/^[1-9]\d{0,9}$/.test(n) || !/^[1-9]\d{0,2}$/.test(r) || !/^[1-9]\d{0,2}$/.test(p)) return null
    if (!/^[a-f0-9]{32}$/.test(sel) || !/^[a-f0-9]{128}$/.test(hash)) return null
    const N = Number(n), R = Number(r), P = Number(p)
    if (!Number.isInteger(Math.log2(N)) || N < N_MIN || N > N_MAX || R > R_MAX || P > P_MAX) return null
    return { N, r: R, p: P, sel: Buffer.from(sel, 'hex'), hash: Buffer.from(hash, 'hex'), ancien: false }
  }
  const [sel, hash, ...reste] = stocke.split('.')
  if (reste.length > 0 || !/^[a-f0-9]{32}$/.test(sel ?? '') || !/^[a-f0-9]{128}$/.test(hash ?? '')) return null
  // L'ancien sel est utilisé comme chaîne UTF-8 (hex), comme avant.
  return { ...ANCIEN, sel: Buffer.from(sel), hash: Buffer.from(hash, 'hex'), ancien: true }
}

export async function verifyPassword(motDePasse: string, hash: string): Promise<boolean> {
  try {
    const d = decoder(hash)
    if (!d) return false
    const calcule = await deriver(motDePasse, d.sel, d.hash.length, d.N, d.r, d.p)
    return calcule.length === d.hash.length && timingSafeEqual(calcule, d.hash)
  } catch {
    return false
  }
}

export function doitRehacher(hash: string): boolean {
  const d = decoder(hash)
  if (!d || d.ancien) return true
  return d.N < N_ACTUEL || d.r < R_ACTUEL || d.p < P_ACTUEL
}

/** Calcule un scrypt au coût actuel avec un sel fixe : égalise le temps de réponse d'un compte inconnu. */
export async function verifierFauxMotDePasse(motDePasse: string): Promise<void> {
  try {
    await deriver(motDePasse, SEL_FAUX, TAILLE_HASH, N_ACTUEL, R_ACTUEL, P_ACTUEL)
  } catch {
    // Sans effet : seul le coût de calcul compte.
  }
}
