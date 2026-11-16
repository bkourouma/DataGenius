import { getSession } from '@/lib/auth/utils'
import { enregistrerAudit } from './enregistrer'
import type { EntreeAudit } from './types'

/**
 * Comme `enregistrerAudit`, mais l'acteur est l'utilisateur de la session courante (server actions
 * et routes). N'échoue jamais : sans session lisible, l'événement est écrit sans acteur.
 */
export async function enregistrerAuditSession(entree: Omit<EntreeAudit, 'acteurId'>): Promise<void> {
  let acteurId: string | null = null
  try {
    acteurId = (await getSession())?.user?.id ?? null
  } catch {
    // Session illisible : l'audit se fait sans acteur plutôt que de perdre l'événement.
  }
  await enregistrerAudit({ ...entree, acteurId })
}
