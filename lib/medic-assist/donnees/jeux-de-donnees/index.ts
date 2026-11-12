/**
 * Stockage des jeux de données de Medic Assist (lot 2) : enregistrement, lecture contrôlée,
 * rejeu dans le périmètre du lecteur, export.
 */

export {
  chargerJeuAccessible,
  chargerJeuDuProprietaire,
  requeteAccesJeu,
  erreurIntrouvable,
} from './acces-jeu'
export { calculerTotaux, estAdditive, lignesVersCellules, versCellule } from './agregats'
export { empreintePerimetre } from './empreinte'
export { enregistrerJeu, preparerContenu } from './enregistrer'
export { lireJeu, lignesCompletesPourExport } from './lire'
export { provenanceVisible, retirerSql } from './provenance'
export { estRejouable, rejouerSpec } from './rejouer'
export {
  MESSAGE_JEU_INTROUVABLE,
  type DonneesJeuAEnregistrer,
  type JeuCompletPourExport,
  type OptionsLireJeu,
  type OptionsViaArtefact,
  RequetePieceJointeSchema,
  type RequetePieceJointe,
} from './types'
