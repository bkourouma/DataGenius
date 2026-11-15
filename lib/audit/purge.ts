import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'
import { CONSERVATION_JOURS } from './types'

const INTERVALLE_PURGE_MS = 60 * 60_000

// Dernière tentative de purge dans ce processus (au plus une par heure sans `forcer`).
let dernierePurge = 0

/** Supprime les lignes plus vieilles que `jours` jours et renvoie leur nombre. */
export async function purgerAudit(jours: number = CONSERVATION_JOURS): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM warehouse.journal_audit
    WHERE fait_a < now() - make_interval(days => ${jours}::int)`
}

/** Purge de conservation du journal ; ne lève jamais (l'échec est journalisé). */
export async function purgerJournalAudit(options?: { forcer?: boolean }): Promise<void> {
  const maintenant = Date.now()
  if (!options?.forcer && maintenant - dernierePurge < INTERVALLE_PURGE_MS) return
  dernierePurge = maintenant
  try {
    const supprimees = await purgerAudit()
    if (supprimees > 0) journal.info('Purge du journal d\'audit', { domaine: 'audit', supprimees })
  } catch (erreur) {
    try {
      journal.erreur('Journal d\'audit : purge impossible', {
        domaine: 'audit',
        erreur: erreur instanceof Error ? erreur.name : undefined,
      })
    } catch {
      // Journal technique indisponible : rien de plus à faire.
    }
  }
}
