/**
 * Logique de GET|PUT /api/medic-assist/admin/config et POST /tester (hors acces base et hors
 * garde). Les cles d'API ne sont jamais lues ici : seule la presence d'une variable compte.
 */

import { z } from 'zod'

import {
  FOURNISSEURS,
  MODES_LANGAGE,
  fournisseursDisponibles,
  fournisseursTranscriptionDisponibles,
  modelesParDefaut,
  PLAFOND_COUT_DEFAUT_USD,
  tarifsConnus,
  type ConfigAdminCorps,
  type ConfigMedicAssist,
  type ModeleSecours,
  type PersonneDto,
} from './dependances'
import {
  TAUX_EUR_PAR_USD_DEFAUT,
  type ConfigAdminCorpsLot6,
  type ConfigAdminReponse,
} from './types'

/** Corps de POST /tester : le mode, et au besoin un couple fournisseur/modele pas enregistre. */
export const schemaCorpsTest = z
  .object({
    mode: z.enum(MODES_LANGAGE),
    fournisseur: z.enum(FOURNISSEURS).optional(),
    modele: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
      .optional(),
  })
  .strict()

/** Separe le taux (propre au lot 6) du corps du lot 0, que `ecrireConfigMedicAssist` attend. */
export function separerTaux(corps: ConfigAdminCorpsLot6): {
  config: ConfigAdminCorps
  tauxEurParUsd: number | undefined
  gardeFous: { plafondCoutJournalierUsd?: number; modeleSecours?: ModeleSecours | null }
} {
  const { tauxEurParUsd, plafondCoutJournalierUsd, modeleSecours, ...config } = corps
  return {
    config,
    tauxEurParUsd,
    gardeFous: {
      ...(plafondCoutJournalierUsd !== undefined ? { plafondCoutJournalierUsd } : {}),
      ...(modeleSecours !== undefined ? { modeleSecours } : {}),
    },
  }
}

export interface MiseAJourConfig {
  majA: Date | null
  majPar: PersonneDto | null
}

export function construireConfigAdminReponse(
  config: ConfigMedicAssist & {
    plafondCoutJournalierUsd: number
    modeleSecours: ModeleSecours | null
  },
  tauxSaisi: number | null,
  maj: MiseAJourConfig
): ConfigAdminReponse {
  return {
    fournisseur: config.fournisseur,
    modeles: config.modeles,
    transcription: config.transcription,
    fournisseursDisponibles: fournisseursDisponibles(),
    fournisseursTranscriptionDisponibles: fournisseursTranscriptionDisponibles(),
    modelesParDefaut: modelesParDefaut(),
    tarifs: tarifsConnus(),
    majA: maj.majA ? maj.majA.toISOString() : null,
    majPar: maj.majPar,
    tauxEurParUsd: tauxSaisi ?? TAUX_EUR_PAR_USD_DEFAUT,
    tauxSource: tauxSaisi === null ? 'defaut' : 'config',
    plafondCoutJournalierUsd: config.plafondCoutJournalierUsd,
    plafondParDefaut: PLAFOND_COUT_DEFAUT_USD,
    modeleSecours: config.modeleSecours,
  }
}

/** Erreur de validation de la configuration levee par le lot 1 (champ `code` stable). */
export function codeErreurConfig(
  erreur: unknown
): 'fournisseurIndisponible' | 'validationInvalide' | null {
  const code = (erreur as { code?: unknown } | null)?.code
  if (
    code === 'fournisseur_indisponible' ||
    code === 'fournisseur_non_configure' ||
    code === 'transcription_indisponible'
  ) {
    return 'fournisseurIndisponible'
  }
  if (
    code === 'fournisseur_inconnu' ||
    code === 'modele_invalide' ||
    code === 'plafond_invalide' ||
    code === 'modele_secours_inconnu'
  ) {
    return 'validationInvalide'
  }
  return null
}
