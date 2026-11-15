import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'
import { lireEtatWorker } from '@/lib/warehouse/etat-worker'

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

type SanteWorker = {
  statut: 'marche' | 'en_retard' | 'arrete' | 'jamais_vu' | null
  ageSecondes: number | null
}

// Ni hôte, ni version, ni instance : seulement l'état et l'âge du dernier signe de vie.
async function santeWorker(): Promise<SanteWorker> {
  try {
    const etat = await lireEtatWorker()
    return {
      statut: etat.statut,
      ageSecondes: etat.silenceMs === null ? null : Math.max(0, Math.floor(etat.silenceMs / 1000)),
    }
  } catch {
    return { statut: null, ageSecondes: null }
  }
}

export async function GET() {
  const baseOk = await verifierBase()
  const ageSecondes = baseOk ? await ageSynchronisation() : null
  const worker: SanteWorker = baseOk ? await santeWorker() : { statut: null, ageSecondes: null }
  return NextResponse.json(
    {
      statut: baseOk ? 'ok' : 'degrade',
      base: baseOk ? 'ok' : 'ko',
      synchronisation: { ageSecondes },
      worker,
    },
    { status: baseOk ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  )
}
