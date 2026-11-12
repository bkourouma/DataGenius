/**
 * Contrats d'API propres a l'administration de Medic Assist (lot 6), en COMPLEMENT
 * des DTO du lot 0 (`@/lib/medic-assist/contrats` : ConfigAdminDto, ConfigAdminCorpsSchema,
 * UsagesDto, UsagesQuerySchema, ListeAvisAdminDto, AvisAdminQuerySchema, PieceJointeDto,
 * TranscriptionDto), qui font foi. Fichier pur : chargeable cote client comme cote serveur.
 *
 * Ajouts du lot 6 : taux de change EUR/USD (les DTO du lot 0 sont en USD), test d'un
 * modele, export Excel des usages.
 */

import { z } from 'zod'

import {
  ConfigAdminCorpsSchema,
  type ConfigAdminDto,
  type Fournisseur,
  type ModeLangage,
  type UsagesDto,
} from '@/lib/medic-assist/contrats'

/** Taux EUR pour 1 USD quand l'administrateur n'en a saisi aucun (documente dans l'ecran). */
export const TAUX_EUR_PAR_USD_DEFAUT = 0.92

/** Cle ParametreApplication du taux saisi (propre au lot 6). */
export const CLE_PARAMETRE_TAUX_EUR = 'medic_assist.taux_eur_par_usd'

export const TAUX_EUR_PAR_USD_MAX = 10

export type TauxSource = 'config' | 'defaut'

// ---- GET|PUT /api/medic-assist/admin/config ---------------------------------

/** GET et PUT rendent la configuration du lot 0 plus le taux de change. */
export interface ConfigAdminReponse extends ConfigAdminDto {
  tauxEurParUsd: number
  tauxSource: TauxSource
}

/**
 * Corps de PUT : celui du lot 0 (fournisseur, 3 modeles, transcription : TOUS les champs),
 * plus le taux facultatif. Strict : un champ inconnu est refuse.
 */
export const ConfigAdminCorpsLot6Schema = ConfigAdminCorpsSchema.extend({
  tauxEurParUsd: z.number().gt(0).max(TAUX_EUR_PAR_USD_MAX).optional(),
}).strict()
export type ConfigAdminCorpsLot6 = z.infer<typeof ConfigAdminCorpsLot6Schema>

// ---- POST /api/medic-assist/admin/tester -------------------------------------

export const CODES_ERREUR_TEST = [
  'delai',
  'clefRefusee',
  'modeleIntrouvable',
  'limite',
  'indisponible',
  'reseau',
  'certificat',
  'inconnue',
] as const
export type CodeErreurTest = (typeof CODES_ERREUR_TEST)[number]

/** Teste le modele d'un mode (ou un couple fournisseur/modele pas encore enregistre). */
export interface CorpsTestAdmin {
  mode: ModeLangage
  fournisseur?: Fournisseur
  modele?: string
}

export interface ResultatTestAdmin {
  ok: boolean
  latenceMs: number
  fournisseur: Fournisseur
  modele: string
  /** Code stable, traduit cote interface (medicAssistAdmin.configuration.test.erreurs.<code>). */
  erreurCode?: CodeErreurTest
}

// ---- GET /api/medic-assist/admin/usages --------------------------------------
// Parametres du lot 0 (UsagesQuerySchema : du, au, groupement, utilisateurId, fournisseur,
// modele, mode) plus `format=json|xlsx` (defaut json). xlsx : fichier a la charte.

export const FORMATS_USAGES = ['json', 'xlsx'] as const
export type FormatUsages = (typeof FORMATS_USAGES)[number]

/** Les usages du lot 0 plus le taux, pour afficher l'euro. */
export interface UsagesReponse extends UsagesDto {
  tauxEurParUsd: number
  tauxSource: TauxSource
}

/** Fenetre maximale d'un releve d'usages, en jours. */
export const USAGES_FENETRE_MAX_JOURS = 400
