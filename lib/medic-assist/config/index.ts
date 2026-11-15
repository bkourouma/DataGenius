/**
 * Configuration de Medic Assist (fournisseur, modèles, transcription, tarifs).
 * Point d'entrée unique : les autres lots importent depuis `@/lib/medic-assist/config`.
 */

export {
  ErreurConfigMedicAssist,
  ErreurFournisseurAbsent,
  type CodeErreurConfig,
  type ConfigEffective,
  type ConfigMedicAssist,
  type ModeleSecours,
  type TarifAvecSource,
} from './types'
export {
  ecrireConfigMedicAssist,
  fournisseursDisponibles,
  fournisseursTranscriptionDisponibles,
  lireConfigMedicAssist,
  lireTranscription,
} from './parametres'
export { REGISTRE_FOURNISSEURS, estFournisseur, modelesParDefaut } from './fournisseurs'
export { TARIFS_AVEC_SOURCE, calculerCoutUsd, tarifModele, tarifsConnus } from './tarifs'
export { creerModele, optionsCachePrompt } from './modeles'
export {
  CLE_MODELE_SECOURS,
  CLE_PLAFOND_COUT_JOURNALIER,
  PLAFOND_COUT_DEFAUT_USD,
  PLAFOND_COUT_MAX_USD,
  ecrireGardeFous,
  lireModeleSecours,
  lirePlafondCout,
  modeleConnu,
  validerGardeFous,
  type GardeFousEntree,
  type GardeFousValides,
} from './garde-fous'
