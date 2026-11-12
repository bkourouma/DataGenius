/**
 * Couche de données de Medic Assist (architecture §5) : point d'entrée unique que les
 * lots 1, 4, 5 et 6 appellent. Les signatures sont celles posées par le lot 0.
 *
 * Règles communes :
 * - `contexte` est TOUJOURS le premier argument (sauf `lireJeu` et
 *   `lignesCompletesPourExport` : `(id, contexte, ...)`) ;
 * - lecture seule stricte sur les données métier ; le périmètre vient de `contexte.scope`,
 *   jamais du modèle ;
 * - une relecture par id vérifie le propriétaire (ou un partage) dans le même `where` ;
 * - les erreurs prévisibles sont des `ErreurDonnees` (code stable) ; `versErreurOutil`
 *   (./erreurs-outils) les traduit en `ErreurOutil` pour le modèle.
 *
 * Implémentations :
 * - catalogue_donnees, interroger_donnees, requete_sql, jeux de données : ./outils-donnees
 *   (moteur sémantique ./moteur, SQL contrôlé ./sql, catalogue ./catalogue) ;
 * - rechercher_entites : ./entites ; resume_mensuel : ./resume-mensuel ;
 * - briefing : ./briefing ; résumé compact du catalogue : ./catalogue.
 */

import type { ContexteExecution } from '@/lib/medic-assist/contrats'

import { resumeCatalogueCompact as resumeCatalogue } from './catalogue'
import { registreAutorise } from './catalogue/autorisation'

export {
  catalogueDonnees,
  enregistrerJeuDeDonnees,
  interrogerDonnees,
  lignesCompletesPourExport,
  lireJeu,
  requeteSql,
} from './outils-donnees'
export type { DonneesJeuAEnregistrer, JeuCompletPourExport, OptionsLireJeu } from './outils-donnees'

/**
 * Résumé compact du catalogue (jeux, mesures, dimensions) pour le prompt système.
 * Déterministe (même entrée, même texte : cache de prompt) et sous
 * 2 500 tokens. `contexte` (facultatif) fixe la langue des libellés.
 */
export async function resumeCatalogueCompact(contexte?: ContexteExecution): Promise<string> {
  return resumeCatalogue(contexte, await registreAutorise(contexte))
}
