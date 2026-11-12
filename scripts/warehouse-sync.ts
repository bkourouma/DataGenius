import { setTimeout } from 'node:timers/promises'
import { prisma } from '@/lib/db/client'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'

const arret = new AbortController()
const boucle = process.argv.includes('--watch')
const forcer = process.argv.includes('--force')
process.on('SIGINT', () => arret.abort())
process.on('SIGTERM', () => arret.abort())

async function main() {
  if (boucle && forcer) throw new Error('Utiliser --force pour une exécution ponctuelle.')
  do {
    try {
      const resultats = await synchroniserEntrepot({ forcer })
      for (const { jeu, statut } of resultats) {
        if (statut !== 'pas_echu' && statut !== 'en_cours') console.log(jeu, statut)
      }
      if (!boucle && resultats.some(r => r.statut === 'echec')) process.exitCode = 1
    } catch {
      console.error('Synchronisation indisponible. Vérifiez le catalogue et la base interne.')
      if (!boucle) process.exitCode = 1
    }
    if (boucle && !arret.signal.aborted) {
      await setTimeout(15_000, undefined, { signal: arret.signal }).catch(() => undefined)
    }
  } while (boucle && !arret.signal.aborted)
}

main().catch(() => {
  console.error('Impossible de démarrer la synchronisation.')
  process.exitCode = 1
}).finally(async () => {
  await Promise.all([prisma.$disconnect(), deconnecterPostgres()])
})
