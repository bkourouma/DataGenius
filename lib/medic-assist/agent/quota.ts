/**
 * Plafond de coût journalier par utilisateur (R2). Le coût est la somme de
 * `assistantUsage.coutUsd` (chat ET transcription : même table) depuis minuit UTC (GMT,
 * Abidjan), décision de l'utilisateur. Les statistiques d'usage de l'administration restent en
 * Europe/Paris (admin/usages.ts) : seul le plafond suit minuit UTC.
 *
 * Plafond 0, négatif ou non fini = désactivé : aucune requête base.
 */

import { prisma } from '@/lib/db/client'
export type VerdictQuota =
  | { autorise: true }
  | { autorise: false; plafondUsd: number; consommeUsd: number; reinitialisationA: Date }

/** Minuit UTC (début du jour courant). */
export function debutDeJournee(maintenant: Date): Date {
  return new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()))
}

/** Minuit UTC suivant (pas de passage d'heure en UTC : toujours 24 h). */
export function finDeJournee(maintenant: Date): Date {
  return new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate() + 1))
}

export async function verifierQuotaJournalier(
  userId: string,
  plafondUsd: number,
  maintenant: Date = new Date()
): Promise<VerdictQuota> {
  if (!Number.isFinite(plafondUsd) || plafondUsd <= 0) return { autorise: true }
  const agregat = await prisma.assistantUsage.aggregate({
    where: { userId, createdAt: { gte: debutDeJournee(maintenant) } },
    _sum: { coutUsd: true },
  })
  const somme = agregat._sum.coutUsd
  const consommeUsd = somme == null ? 0 : Number(somme.toString())
  if (!(consommeUsd >= plafondUsd)) return { autorise: true }
  return { autorise: false, plafondUsd, consommeUsd, reinitialisationA: finDeJournee(maintenant) }
}
