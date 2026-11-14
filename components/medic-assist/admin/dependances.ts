/**
 * Point unique des dépendances de l'interface d'administration : constantes, types et DTO réexportés
 * depuis `@/lib/medic-assist/contrats`.
 */

export {
  FOURNISSEURS,
  FOURNISSEURS_TRANSCRIPTION,
  MODES,
  MODES_LANGAGE,
  VALEURS_AVIS,
  VARIABLES_CLES_FOURNISSEURS,
} from '@/lib/medic-assist/contrats';
export type {
  AgregatUsage,
  AvisAdminDto,
  ConfigAdminDto,
  ConfigTranscription,
  Fournisseur,
  FournisseurTranscription,
  ListeAvisAdminDto,
  Mode,
  ModeLangage,
  PageCurseur,
  PersonneDto,
  TarifModele,
  UsagesDto,
  ValeurAvis,
} from '@/lib/medic-assist/contrats';
