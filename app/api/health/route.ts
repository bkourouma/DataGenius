import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'

export const dynamic = 'force-dynamic'

const DELAI_BASE_MS = 2000

async function verifierBase(): Promise<boolean> {
  let minuteur: ReturnType<typeof setTimeout> | undefined
  try {
    const delai = new Promise<never>((_, rejeter) => {
      minuteur = setTimeout(() => rejeter(new Error('delai')), DELAI_BASE_MS)
    })
    await Promise.race([prisma.$queryRaw`SELECT 1`, delai])
    return true
  } catch (erreur) {
    journal.erreur('Santé : base injoignable', {
      code: (erreur as { code?: unknown })?.code ?? 'inconnu',
    })
    return false
  } finally {
    clearTimeout(minuteur)
  }
}

async function ageSynchronisation(): Promise<number | null> {
  try {
    const lignes = await prisma.$queryRaw<{ age: number | string | null }[]>`
      SELECT EXTRACT(EPOCH FROM (now() - MAX(verifie_a)))::float8 AS age
      FROM warehouse.synchronisations`
    const age = lignes[0]?.age
    if (age === null || age === undefined) return null
    const secondes = Number(age)
    return Number.isFinite(secondes) ? Math.max(0, Math.floor(secondes)) : null
  } catch {
    return null
  }
}

export async function GET() {
  const baseOk = await verifierBase()
  const ageSecondes = baseOk ? await ageSynchronisation() : null
  return NextResponse.json(
    {
      statut: baseOk ? 'ok' : 'degrade',
      base: baseOk ? 'ok' : 'ko',
      synchronisation: { ageSecondes },
    },
    { status: baseOk ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  )
}
