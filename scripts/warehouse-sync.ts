import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { setTimeout } from 'node:timers/promises'
import { prisma } from '@/lib/db/client'
import { ErreurEnvironnement, verifierEnvironnement } from '@/lib/env'
import { journal } from '@/lib/journal'
import {
  avecBattementPeriodique, enregistrerBattement, hoteCourt, INTERVALLE_BOUCLE_MS, nettoyerInstancesMuettesSiEchu, type ResumeTour,
} from '@/lib/warehouse/etat-worker'
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

// Identité du worker (mode --watch seulement) : jamais d'IP ni de secret, hôte réduit à son premier label.
const instance = randomUUID()
const meta = {
  hote: hoteCourt(hostname()),
  version: process.env.npm_package_version ?? 'inconnue',
  intervalleMs: INTERVALLE_BOUCLE_MS,
}

// Un battement ne doit jamais arrêter la boucle (enregistrerBattement ne lève pas, ceci est défensif).
async function battre(tour?: ResumeTour) {
  if (!boucle) return
  try {
    await enregistrerBattement(instance, meta, tour)
  } catch {
    // Déjà journalisé par enregistrerBattement ; on continue.
  }
}

async function nettoyerInstances() {
  if (!boucle) return
  try {
    await nettoyerInstancesMuettesSiEchu()
  } catch {
    // Le nettoyage est facultatif.
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
    const debutTour = Date.now()
    let jeux = 0
    let erreurs = 0
    await battre()
    // Battement périodique pendant tout le traitement : un tour long ne doit pas passer pour un arrêt.
    await avecBattementPeriodique(() => battre(), INTERVALLE_BOUCLE_MS, async () => {
      try {
        const resultats = await synchroniserEntrepotDetaille({ forcer, signal: arret.signal })
        for (const { jeu, statut, code, dureeMs } of resultats) {
          if (statut === 'publie' || statut === 'identique') jeux += 1
          if (statut === 'echec') { jeux += 1; erreurs += 1 }
          if (statut === 'pas_echu' || statut === 'en_cours') continue
          const ligne = { jeu, statut, code: code ?? null, dureeMs }
          if (statut === 'echec') journal.erreur('Synchronisation en échec', ligne)
          else journal.info('Synchronisation terminée', ligne)
        }
        if (!boucle && resultats.some(r => r.statut === 'echec')) process.exitCode = 1
      } catch (erreur) {
        erreurs += 1
        journal.erreur('Synchronisation impossible', { code: 'catalogue_ou_base_indisponible', ...causeJournal(erreur) })
        if (!boucle) process.exitCode = 1
      }
      await purger(!boucle)
    })
    await battre({ dureeMs: Date.now() - debutTour, jeux, erreurs })
    await nettoyerInstances()
    if (boucle && !arret.signal.aborted) {
      await setTimeout(INTERVALLE_BOUCLE_MS, undefined, { signal: arret.signal }).catch(() => undefined)
    }
  } while (boucle && !arret.signal.aborted)
}

main().catch(erreur => {
  journal.erreur('Démarrage de la synchronisation impossible', { code: 'demarrage_impossible', ...causeJournal(erreur) })
  process.exitCode = 1
}).finally(async () => {
  await Promise.all([prisma.$disconnect(), deconnecterPostgres()])
})
