/**
 * Point UNIQUE des dependances du lot 6 (admin et transcription) envers les lots 0 et 1 :
 * contrats, gardes (lot 0) et configuration (lot 1), reexportes tels quels.
 */

export {
  AvisAdminQuerySchema,
  CHAMPS_TELEVERSEMENT,
  CLES_PARAMETRES,
  FOURNISSEURS,
  FOURNISSEURS_TRANSCRIPTION,
  LIMITES,
  MODELES_CLAUDE_PAR_DEFAUT,
  MODES,
  MODES_LANGAGE,
  UsagesQuerySchema,
  VARIABLES_CLES_FOURNISSEURS,
} from '@/lib/medic-assist/contrats'
export type {
  AgregatUsage,
  AvisAdminDto,
  AvisAdminQuery,
  ConfigAdminCorps,
  ConfigAdminDto,
  ConfigTranscription,
  ContexteExecution,
  Fournisseur,
  FournisseurTranscription,
  Mode,
  ModeLangage,
  ModelesParMode,
  PageCurseur,
  PersonneDto,
  TarifModele,
  UsagesDto,
  UsagesQuery,
  ValeurAvis,
} from '@/lib/medic-assist/contrats'

export { exigerAdminMedicAssist, exigerMedicAssist } from '@/lib/medic-assist/acces'

export {
  ecrireConfigMedicAssist,
  fournisseursDisponibles,
  lireConfigMedicAssist,
  tarifModele,
  type ConfigMedicAssist,
  // Lot 1 : memes noms ; `creerModele` est SYNCHRONE et leve ErreurFournisseurAbsent.
  creerModele,
  fournisseursTranscriptionDisponibles,
  modelesParDefaut,
  tarifsConnus,
} from '@/lib/medic-assist/config'
