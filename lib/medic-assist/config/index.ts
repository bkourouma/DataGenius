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
