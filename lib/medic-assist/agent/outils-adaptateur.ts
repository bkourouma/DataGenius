/**
 * Branchement des outils de l'agent sur les implémentations réelles : couche de données
 * (lot 2), artefacts (lot 4), actions (lot 5) et pièces jointes (lot 6).
 *
 * Tant qu'un lot n'a pas livré, sa souche lève « non implémenté » : l'outil concerné
 * renvoie alors une `ErreurOutil` de code `interne` (jamais d'exception).
 */

import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { creerArtefact, modifierArtefact } from '@/lib/medic-assist/artefacts/stockage'
import {
  catalogueDonnees,
  interrogerDonnees,
  requeteSql,
} from '@/lib/medic-assist/donnees/outils'
import { lirePieceJointe } from '@/lib/medic-assist/pieces-jointes/lecture'
import { chargerComptesAvecAcces } from '@/lib/medic-assist/suivi/comptes'
import { ErreurDonnees } from '@/lib/medic-assist/donnees/types'
import { proposerAction } from '@/lib/medic-assist/suivi/actions'

import { creerOutils, type DependancesOutils, type OptionsOutils } from './outils'
function indisponible(): never {
  throw new ErreurDonnees('Cet outil est propre à Data Genius.', 'requete_invalide')
}

const rechercherEntites: DependancesOutils['rechercherEntites'] = async (_ctx, entree) => {
  if (entree.types && !entree.types.includes('utilisateur')) return []
  const comptes = await chargerComptesAvecAcces({ recherche: entree.texte, limite: entree.limite ?? 20 })
  return comptes.map(compte => ({ id: compte.id, type: 'utilisateur', libelle: compte.nom }))
}

export function dependancesReelles(): DependancesOutils {
  return {
    catalogueDonnees,
      interrogerDonnees,
    requeteSql,
      lirePieceJointe,
    creerArtefact,
    modifierArtefact,
    proposerAction,
    rechercherEntites,
    resumeMensuel: indisponible,
    preparerAlerte: indisponible,
  }
}

/** Les onze outils branchés sur les lots 2, 4, 5 et 6 (et l'alerte préparée, sans écriture), pour le contexte de la requête. */
export function creerOutilsReels(ctx: ContexteExecution, options: OptionsOutils = {}) {
  const { resume_mensuel, preparer_alerte, ...outils } = creerOutils(ctx, dependancesReelles(), options)
  return outils
}

