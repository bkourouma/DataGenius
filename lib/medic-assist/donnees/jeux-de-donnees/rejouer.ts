/**
 * Rejeu d'une spécification stockée avec le périmètre du LECTEUR (jamais celui du
 * propriétaire) : même voie que l'outil d'origine (moteur sémantique ou SQL contrôlé).
 */

import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { aplatirRequete } from '@/lib/medic-assist/donnees/requete-interne'
import { calculerSemantique } from '@/lib/medic-assist/donnees/moteur/calculer'
import { calculerSql } from '@/lib/medic-assist/donnees/sql/calcul'
import { ErreurDonnees, type ResultatCalcule } from '@/lib/medic-assist/donnees/types'

/** Sources qu'on sait rejouer ; une pièce jointe (ou toute autre source) n'est jamais rejouée. */
export function estRejouable(source: string): source is 'semantique' | 'sql' {
  return source === 'semantique' || source === 'sql'
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
}

/** Rejoue `requete` (source `semantique`) ou `{sql, objectif}` (source `sql`) pour `contexte`. */
export async function rejouerSpec(
  source: string,
  requete: unknown,
  contexte: ContexteExecution,
  limiteLignes: number
): Promise<ResultatCalcule> {
  if (!estObjet(requete)) {
    throw new ErreurDonnees('La spécification du jeu est illisible.', 'requete_invalide')
  }
  if (source === 'semantique') {
    // Le moteur revalide tout (jeu, mesures, filtres) contre le catalogue actuel.
    return calculerSemantique(aplatirRequete(requete as never), contexte, { limiteLignes })
  }
  if (source === 'sql') {
    const sql = typeof requete.sql === 'string' ? requete.sql : ''
    const objectif = typeof requete.objectif === 'string' ? requete.objectif : ''
    return calculerSql({ sql, objectif }, contexte, { limiteLignes })
  }
  throw new ErreurDonnees('Ce jeu ne peut pas être recalculé.', 'jeu_non_rejouable')
}
