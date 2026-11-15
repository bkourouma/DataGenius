import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'

export const DELAI_ARRET_MS = 5 * 60_000
export const INTERVALLE_BOUCLE_MS = 15_000
export const FACTEUR_RETARD = 2
export const RETENTION_INSTANCES_JOURS = 7
const INTERVALLE_NETTOYAGE_MS = 3_600_000

// Copie du strict nécessaire de causeJournal (synchronisation.ts) : évite d'importer tout le graphe de
// synchronisation dans la route de santé et les pages. Jamais le message (il pourrait contenir une requête).
function causeJournal(erreur: unknown) {
  const e = erreur as { name?: unknown; code?: unknown; meta?: { code?: unknown } } | null
  return {
    erreur: typeof e?.name === 'string' ? e.name : typeof erreur,
    codeErreur: typeof e?.code === 'string' ? e.code : undefined,
    sqlstate: typeof e?.meta?.code === 'string' ? e.meta.code : undefined,
  }
}

export type StatutWorker = 'marche' | 'en_retard' | 'arrete'

export type EtatWorker = {
  statut: StatutWorker | 'jamais_vu'
  silenceMs: number | null
  instance: {
    hote: string
    version: string
    demarreA: Date
    dernierSigneA: Date
    dernierTour: { a: Date; dureeMs: number; jeux: number; erreurs: number } | null
  } | null
}

export type ResumeTour = { dureeMs: number; jeux: number; erreurs: number }

export function evaluerEtatWorker({ silenceMs, intervalleMs }: { silenceMs: number; intervalleMs: number }): StatutWorker {
  if (silenceMs > DELAI_ARRET_MS) return 'arrete'
  if (silenceMs > FACTEUR_RETARD * intervalleMs) return 'en_retard'
  return 'marche'
}

// Premier label du nom d'hôte ; jamais une adresse IP (ni rien de vide) dans l'état stocké.
export function hoteCourt(brut: string): string {
  const nettoye = brut.trim()
  const label = nettoye.split('.')[0]?.slice(0, 63) ?? ''
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(nettoye)
  const ipv6 = nettoye.includes(':')
  if (!label || ipv4 || ipv6 || /^\d+$/.test(label)) return 'inconnu'
  return label
}

// Un seul UPSERT ; ne lève jamais : une panne d'écriture ne doit pas arrêter le worker.
export async function enregistrerBattement(
  instance: string,
  meta: { hote: string; version: string; intervalleMs: number },
  tour?: ResumeTour,
): Promise<boolean> {
  try {
    const a = tour ?? null
    await prisma.$executeRaw`
      INSERT INTO warehouse.worker_etat
        (instance, hote, version, demarre_a, dernier_signe_a, intervalle_ms,
         dernier_tour_a, dernier_tour_duree_ms, dernier_tour_jeux, dernier_tour_erreurs)
      VALUES (${instance}, ${meta.hote}, ${meta.version}, clock_timestamp(), clock_timestamp(), ${meta.intervalleMs}::int,
        CASE WHEN ${a !== null} THEN clock_timestamp() END,
        ${a?.dureeMs ?? null}::int, ${a?.jeux ?? null}::int, ${a?.erreurs ?? null}::int)
      ON CONFLICT (instance) DO UPDATE SET
        hote = EXCLUDED.hote, version = EXCLUDED.version, intervalle_ms = EXCLUDED.intervalle_ms,
        dernier_signe_a = clock_timestamp(),
        dernier_tour_a = CASE WHEN ${a !== null} THEN clock_timestamp() ELSE warehouse.worker_etat.dernier_tour_a END,
        dernier_tour_duree_ms = CASE WHEN ${a !== null} THEN EXCLUDED.dernier_tour_duree_ms ELSE warehouse.worker_etat.dernier_tour_duree_ms END,
        dernier_tour_jeux = CASE WHEN ${a !== null} THEN EXCLUDED.dernier_tour_jeux ELSE warehouse.worker_etat.dernier_tour_jeux END,
        dernier_tour_erreurs = CASE WHEN ${a !== null} THEN EXCLUDED.dernier_tour_erreurs ELSE warehouse.worker_etat.dernier_tour_erreurs END
    `
    return true
  } catch (erreur) {
    journal.avertissement('Battement du worker : écriture impossible', {
      code: 'battement_impossible', ...causeJournal(erreur),
    })
    return false
  }
}

export async function nettoyerInstancesMuettes(): Promise<number> {
  try {
    return await prisma.$executeRaw`
      DELETE FROM warehouse.worker_etat
      WHERE dernier_signe_a < clock_timestamp() - ${RETENTION_INSTANCES_JOURS}::int * interval '1 day'
    `
  } catch (erreur) {
    journal.avertissement('Nettoyage des instances du worker impossible', {
      code: 'nettoyage_instances_impossible', ...causeJournal(erreur),
    })
    return 0
  }
}

// Exécute `traitement` en émettant un battement toutes les `intervalleMs` ; le minuteur est toujours
// arrêté (même si le traitement lève) et un battement qui échoue n'interrompt jamais rien.
export async function avecBattementPeriodique<T>(
  battre: () => Promise<unknown>,
  intervalleMs: number,
  traitement: () => Promise<T>,
): Promise<T> {
  const minuteur = setInterval(() => {
    try {
      void Promise.resolve(battre()).catch(() => undefined)
    } catch {
      // Un battement ne doit jamais faire échouer le traitement.
    }
  }, intervalleMs)
  minuteur.unref?.()
  try {
    return await traitement()
  } finally {
    clearInterval(minuteur)
  }
}

let dernierNettoyage = 0

// Nettoie au plus une fois par heure et par processus ; renvoie null si ce n'est pas encore échu.
export async function nettoyerInstancesMuettesSiEchu(maintenant = Date.now(), intervalleMs = INTERVALLE_NETTOYAGE_MS) {
  if (maintenant - dernierNettoyage < intervalleMs) return null
  dernierNettoyage = maintenant
  return nettoyerInstancesMuettes()
}

type LigneEtat = {
  hote: string
  version: string
  demarre_a: Date
  dernier_signe_a: Date
  intervalle_ms: number
  dernier_tour_a: Date | null
  dernier_tour_duree_ms: number | null
  dernier_tour_jeux: number | null
  dernier_tour_erreurs: number | null
  silence_ms: number | string
}

// Les erreurs SQL se propagent : l'appelant décide quoi afficher.
export async function lireEtatWorker(): Promise<EtatWorker> {
  const lignes = await prisma.$queryRaw<LigneEtat[]>`
    SELECT hote, version, demarre_a, dernier_signe_a, intervalle_ms,
      dernier_tour_a, dernier_tour_duree_ms, dernier_tour_jeux, dernier_tour_erreurs,
      (EXTRACT(EPOCH FROM (now() - dernier_signe_a)) * 1000)::float8 AS silence_ms
    FROM warehouse.worker_etat
    ORDER BY dernier_signe_a DESC
    LIMIT 1
  `
  const ligne = lignes[0]
  if (!ligne) return { statut: 'jamais_vu', silenceMs: null, instance: null }
  const silenceMs = Math.max(0, Number(ligne.silence_ms))
  return {
    statut: evaluerEtatWorker({ silenceMs, intervalleMs: ligne.intervalle_ms }),
    silenceMs,
    instance: {
      hote: ligne.hote,
      version: ligne.version,
      demarreA: ligne.demarre_a,
      dernierSigneA: ligne.dernier_signe_a,
      dernierTour: ligne.dernier_tour_a
        ? {
            a: ligne.dernier_tour_a,
            dureeMs: ligne.dernier_tour_duree_ms ?? 0,
            jeux: ligne.dernier_tour_jeux ?? 0,
            erreurs: ligne.dernier_tour_erreurs ?? 0,
          }
        : null,
    },
  }
}

export type ExecutionEnEchec = { jeu: string; code: string | null; verifieA: Date; dureeMs: number }

// Seulement le code technique : jamais de message d'erreur brut.
export async function lireExecutionsEnEchec(limite = 10): Promise<ExecutionEnEchec[]> {
  const lignes = await prisma.$queryRaw<{ jeu: string; code: string | null; verifie_a: Date; duree_ms: number }[]>`
    SELECT jeu, code, verifie_a, duree_ms
    FROM warehouse.executions
    WHERE statut = 'echec'
    ORDER BY verifie_a DESC, id DESC
    LIMIT ${limite}::int
  `
  return lignes.map(l => ({ jeu: l.jeu, code: l.code, verifieA: l.verifie_a, dureeMs: l.duree_ms }))
}
