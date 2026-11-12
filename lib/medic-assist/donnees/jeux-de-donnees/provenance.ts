/**
 * Provenance d'un jeu : le SQL exécuté n'est montré qu'aux administrateurs (route), jamais au
 * modèle. Les totaux calculés par le serveur sont rangés dans la colonne `provenance` (la table
 * n'a pas de colonne de totaux) sous une clé privée, retirée à la lecture.
 */

import type { ContexteExecution, Provenance } from '@/lib/medic-assist/contrats'
import { peutAdministrerMedicAssist } from '@/lib/medic-assist/contrats/droits'

/** Clé privée de la colonne `provenance` qui porte les totaux du jeu. */
export const CLE_TOTAUX_STOCKES = 'totauxJeu'

function sansCleprivee(provenance: Provenance): Provenance & Record<string, unknown> {
  const copie = { ...provenance } as Provenance & Record<string, unknown>
  delete copie[CLE_TOTAUX_STOCKES]
  return copie
}

/** Copie de la provenance sans SQL (et sans clé privée). */
export function retirerSql(provenance: Provenance): Provenance {
  const copie = sansCleprivee(provenance)
  delete copie.sql
  return copie
}

/** Provenance telle que le lecteur peut la voir : SQL conservé pour un administrateur seulement. */
export function provenanceVisible(
  provenance: Provenance,
  contexte: Pick<ContexteExecution, 'roleName' | 'habilitations'>
): Provenance {
  if (peutAdministrerMedicAssist(contexte.roleName, contexte.habilitations)) {
    return sansCleprivee(provenance)
  }
  return retirerSql(provenance)
}

/** Totaux rangés dans la provenance stockée (ou undefined). */
export function totauxStockes(provenance: unknown): Record<string, number> | undefined {
  if (typeof provenance !== 'object' || provenance === null) return undefined
  const brut = (provenance as Record<string, unknown>)[CLE_TOTAUX_STOCKES]
  if (typeof brut !== 'object' || brut === null) return undefined
  const totaux: Record<string, number> = {}
  for (const [cle, valeur] of Object.entries(brut)) {
    if (typeof valeur === 'number' && Number.isFinite(valeur)) totaux[cle] = valeur
  }
  return Object.keys(totaux).length > 0 ? totaux : undefined
}
