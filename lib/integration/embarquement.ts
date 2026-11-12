import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { contexteDepuisCompte } from '@/lib/medic-assist/suivi/comptes'
import { chargerTableau } from '@/lib/warehouse/tableaux'

export const tableauId = z.string().uuid()
export const nonceIntegration = z.string().regex(/^[a-zA-Z0-9_-]{20,100}$/)
export const jetonIntegration = z.string().regex(/^[0-9a-f]{64}$/)

function empreinte(jeton: string) {
  return createHash('sha256').update(jeton).digest('hex')
}

export function origineAutorisee(valeur: unknown) {
  if (typeof valeur !== 'string' || valeur.length > 253) return false
  try {
    const url = new URL(valeur)
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return url.origin === valeur && (url.protocol === 'https:' || local) &&
      (process.env.DATAGENIUS_EMBED_ORIGINS ?? '').split(',').map(o => o.trim()).includes(valeur)
  } catch {
    return false
  }
}

export async function delivrerJeton(contexte: ContexteExecution, id: string, origine: string) {
  if (!tableauId.safeParse(id).success || !origineAutorisee(origine)) return null
  if (!await chargerTableau(id, contexte)) return null
  const jeton = randomBytes(32).toString('hex')
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`DELETE FROM warehouse.jetons_integration WHERE expire_a <= clock_timestamp()`
    await tx.$executeRaw`
      INSERT INTO warehouse.jetons_integration (empreinte, utilisateur_id, tableau_id, origine, expire_a)
      VALUES (${empreinte(jeton)}, ${contexte.userId}, ${id}::uuid, ${origine}, clock_timestamp() + interval '90 seconds')
    `
  })
  return jeton
}

export async function consommerJeton(jeton: string, origine: string) {
  if (!jetonIntegration.safeParse(jeton).success || !origineAutorisee(origine)) return null
  const [autorisation] = await prisma.$queryRaw<{ id: string; userId: string }[]>`
    DELETE FROM warehouse.jetons_integration
    WHERE empreinte = ${empreinte(jeton)} AND origine = ${origine} AND expire_a > clock_timestamp()
    RETURNING tableau_id::text AS id, utilisateur_id AS "userId"
  `
  if (!autorisation) return null
  const contexte = await contexteDepuisCompte(autorisation.userId)
  return contexte ? { id: autorisation.id, contexte } : null
}
