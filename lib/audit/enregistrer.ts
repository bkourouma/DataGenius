import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'
import { borner, texteSur } from './details'
import { ipRequeteCourante } from './ip'
import type { EntreeAudit } from './types'

const LONGUEUR_ID_CIBLE = 128
const LONGUEUR_LIBELLE_CIBLE = 200

/**
 * Ajoute une entrée au journal d'audit. N'ÉCHOUE JAMAIS : l'action métier ne doit pas être
 * empêchée par une panne du journal. En cas d'erreur, seul le nom de l'erreur est journalisé
 * (jamais le message brut ni les détails).
 */
export async function enregistrerAudit(entree: EntreeAudit): Promise<void> {
  try {
    const ip = entree.ip ?? ipRequeteCourante() ?? null
    const details = JSON.stringify(borner(entree.details))
    const cibleId = entree.cible?.id?.slice(0, LONGUEUR_ID_CIBLE) ?? null
    const cibleLibelle = entree.cible?.libelle ? texteSur(entree.cible.libelle, LONGUEUR_LIBELLE_CIBLE) : null
    await prisma.$executeRaw`
      INSERT INTO warehouse.journal_audit
        (acteur_id, action, cible_type, cible_id, cible_libelle, resultat, details, ip)
      VALUES
        (${entree.acteurId ?? null}, ${entree.action}, ${entree.cible?.type ?? null}, ${cibleId},
         ${cibleLibelle}, ${entree.resultat ?? 'succes'}, ${details}::jsonb, ${ip})`
  } catch (erreur) {
    try {
      journal.erreur('Journal d\'audit : écriture impossible', {
        domaine: 'audit',
        action: entree.action,
        erreur: erreur instanceof Error ? erreur.name : undefined,
      })
    } catch {
      // Le journal technique lui-même est indisponible : rien de plus à faire.
    }
  }
}
