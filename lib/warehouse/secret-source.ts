import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function cle() {
  const valeur = process.env.DATAGENIUS_SOURCE_KEY
  if (!valeur || !/^[0-9a-f]{64}$/i.test(valeur)) {
    throw new Error('La clé de chiffrement des connexions est absente ou invalide.')
  }
  return Buffer.from(valeur, 'hex')
}

export function chiffrerSource(id: string, url: string) {
  const iv = randomBytes(12)
  const chiffrement = createCipheriv('aes-256-gcm', cle(), iv)
  chiffrement.setAAD(Buffer.from(id))
  const contenu = Buffer.concat([chiffrement.update(url, 'utf8'), chiffrement.final()])
  return [iv, chiffrement.getAuthTag(), contenu].map(v => v.toString('base64url')).join('.')
}

export function dechiffrerSource(id: string, secret: string) {
  const [iv, tag, contenu] = secret.split('.').map(v => Buffer.from(v, 'base64url'))
  const dechiffrement = createDecipheriv('aes-256-gcm', cle(), iv)
  dechiffrement.setAAD(Buffer.from(id))
  dechiffrement.setAuthTag(tag)
  return Buffer.concat([dechiffrement.update(contenu), dechiffrement.final()]).toString('utf8')
}
