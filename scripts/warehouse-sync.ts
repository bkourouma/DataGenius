import { setTimeout } from 'node:timers/promises'
import { prisma } from '@/lib/db/client'
import { ErreurEnvironnement, verifierEnvironnement } from '@/lib/env'
import { journal } from '@/lib/journal'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import {
  causeJournal, purgerExecutions, purgerExecutionsSiEchu, synchroniserEntrepotDetaille,
} from '@/lib/warehouse/synchronisation'

const arret = new AbortController()
const boucle = process.argv.includes('--watch')
const forcer = process.argv.includes('--force')
let signaux = 0

// Premier signal : la synchronisation en cours se termine, puis le processus sort.
// Second signal : sortie immédiate.
function demanderArret() {
  signaux += 1
  if (signaux > 1) process.exit(1)
  journal.avertissement('Synchronisation : arrêt demandé', { evenement: 'arret_demande' })
  arret.abort()
}
process.on('SIGINT', demanderArret)
process.on('SIGTERM', demanderArret)

async function purger(ponctuelle: boolean) {
  try {
    const supprimees = ponctuelle ? await purgerExecutions() : await purgerExecutionsSiEchu()
    if (supprimees) journal.info('Purge des exécutions', { supprimees })
  } catch (erreur) {
    journal.erreur('Purge des exécutions impossible', { code: 'purge_impossible', ...causeJournal(erreur) })
  }
}

async function main() {
  try {
    verifierEnvironnement('worker')
  } catch (erreur) {
    if (erreur instanceof ErreurEnvironnement) {
      // Noms des variables fautives uniquement, jamais leurs valeurs.
      journal.erreur('Configuration invalide : le worker ne démarre pas', { variables: erreur.variables })
      process.exitCode = 1
      return
    }
    throw erreur
  }
  if (boucle && forcer) throw new Error('Utiliser --force pour une exécution ponctuelle.')
  do {
    try {
      const resultats = await synchroniserEntrepotDetaille({ forcer, signal: arret.signal })
      for (const { jeu, statut, code, dureeMs } of resultats) {
        if (statut === 'pas_echu' || statut === 'en_cours') continue
        const ligne = { jeu, statut, code: code ?? null, dureeMs }
        if (statut === 'echec') journal.erreur('Synchronisation en échec', ligne)
        else journal.info('Synchronisation terminée', ligne)
      }
      if (!boucle && resultats.some(r => r.statut === 'echec')) process.exitCode = 1
    } catch (erreur) {
      journal.erreur('Synchronisation impossible', { code: 'catalogue_ou_base_indisponible', ...causeJournal(erreur) })
      if (!boucle) process.exitCode = 1
    }
    await purger(!boucle)
    if (boucle && !arret.signal.aborted) {
      await setTimeout(15_000, undefined, { signal: arret.signal }).catch(() => undefined)
    }
  } while (boucle && !arret.signal.aborted)
}

main().catch(erreur => {
  journal.erreur('Démarrage de la synchronisation impossible', { code: 'demarrage_impossible', ...causeJournal(erreur) })
  process.exitCode = 1
}).finally(async () => {
  await Promise.all([prisma.$disconnect(), deconnecterPostgres()])
})
