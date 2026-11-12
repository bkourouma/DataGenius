import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  return [salt, scryptSync(password, salt, 64).toString('hex')].join('.')
}

export function verifyPassword(password: string, hash: string) {
  const [salt, digest] = hash.split('.')
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(digest ?? '')) return false
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, 'hex'))
}
