/**
 * Normalisation de l'usage renvoyé par le SDK IA (v7, type `LanguageModelUsage`) vers
 * `UsageTokens` du contrat.
 *
 * Correspondance : `entree` = `inputTokens` (TOTAL, cache compris), `sortie` =
 * `outputTokens`, `cacheLecture` = `inputTokenDetails.cacheReadTokens`, `cacheEcriture` =
 * `inputTokenDetails.cacheWriteTokens`, `raisonnement` =
 * `outputTokenDetails.reasoningTokens` (déjà compris dans `sortie`).
 *
 * Lecture défensive : une valeur absente ou invalide vaut 0, le résultat ne contient
 * jamais NaN et ce sont toujours des entiers positifs ou nuls.
 */

import type { UsageTokens } from '@/lib/medic-assist/contrats'

/** Usage normalisé, tous les champs renseignés. */
export type UsageComplet = Required<UsageTokens>

function nombre(valeur: unknown): number | undefined {
  if (typeof valeur === 'number') {
    return Number.isFinite(valeur) ? Math.max(0, Math.round(valeur)) : undefined
  }
  if (typeof valeur === 'string' && valeur.trim() !== '') {
    const converti = Number(valeur)
    return Number.isFinite(converti) ? Math.max(0, Math.round(converti)) : undefined
  }
  return undefined
}

function objet(valeur: unknown): Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null ? (valeur as Record<string, unknown>) : {}
}

export function usageVide(): UsageComplet {
  return { entree: 0, sortie: 0, cacheLecture: 0, cacheEcriture: 0, raisonnement: 0 }
}

export function normaliserUsage(usageSdk: unknown): UsageComplet {
  const usage = objet(usageSdk)
  const detailsEntree = objet(usage.inputTokenDetails)
  const detailsSortie = objet(usage.outputTokenDetails)

  const cacheLecture = nombre(detailsEntree.cacheReadTokens) ?? nombre(usage.cachedInputTokens) ?? 0
  const cacheEcriture = nombre(detailsEntree.cacheWriteTokens) ?? 0
  const sansCache = nombre(detailsEntree.noCacheTokens)

  const entree =
    nombre(usage.inputTokens) ??
    nombre(usage.promptTokens) ??
    (sansCache === undefined ? 0 : sansCache + cacheLecture + cacheEcriture)
  const sortie = nombre(usage.outputTokens) ?? nombre(usage.completionTokens) ?? 0
  const raisonnement = nombre(detailsSortie.reasoningTokens) ?? 0

  return { entree, sortie, cacheLecture, cacheEcriture, raisonnement }
}

/** Somme de plusieurs usages (liste ou arguments multiples). */
export function additionnerUsages(
  ...usages: Array<UsageTokens | readonly UsageTokens[] | null | undefined>
): UsageComplet {
  const total = usageVide()
  for (const element of usages.flat()) {
    if (!element) continue
    total.entree += nombre(element.entree) ?? 0
    total.sortie += nombre(element.sortie) ?? 0
    total.cacheLecture += nombre(element.cacheLecture) ?? 0
    total.cacheEcriture += nombre(element.cacheEcriture) ?? 0
    total.raisonnement += nombre(element.raisonnement) ?? 0
  }
  return total
}
