/**
 * Types de la configuration des fournisseurs de modèles de Medic Assist.
 *
 * Les types et constantes de base viennent des contrats (`@/lib/medic-assist/contrats`) :
 * rien n'est redéfini ici.
 */

import type {
  ConfigTranscription,
  Fournisseur,
  ModeLangage,
  ModelesParMode,
  TarifModele,
  UsageTokens,
} from '@/lib/medic-assist/contrats'

export type {
  ConfigTranscription,
  Fournisseur,
  ModeLangage,
  ModelesParMode,
  TarifModele,
  UsageTokens,
}

/** Configuration choisie par l'administrateur (ce qui est stocké en base). */
export interface ConfigMedicAssist {
  fournisseur: Fournisseur
  modeles: ModelesParMode
  /** null = dictée du navigateur seulement. */
  transcription: ConfigTranscription
}

/** Modèle utilisé quand le modèle principal échoue. */
export interface ModeleSecours {
  fournisseur: Fournisseur
  modele: string
}

/** Configuration réellement appliquée, après repli éventuel sur Claude. */
export interface ConfigEffective extends ConfigMedicAssist {
  /** Plafond de coût IA par utilisateur et par jour, en USD (0 = désactivé). */
  plafondCoutJournalierUsd: number
  /** Modèle de secours (clé disponible, différent du principal) ou null. */
  modeleSecours: ModeleSecours | null
  /** Vrai si le fournisseur demandé n'avait plus de clé et que Claude le remplace. */
  repliSurClaude: boolean
  /** Fournisseur configuré en base (égal à `fournisseur` quand il n'y a pas de repli). */
  fournisseurDemande: Fournisseur
}

/** Tarif du contrat, enrichi de sa source (usage interne : le contrat ne la porte pas). */
export interface TarifAvecSource extends TarifModele {
  /** URL (ou référence) de la source de tarification. */
  source: string
  /** Date de vérification, `YYYY-MM-DD`. */
  verifieLe: string
  /** Précision éventuelle (hypothèse, condition de palier). */
  note?: string
}

export type CodeErreurConfig =
  | 'fournisseur_inconnu'
  | 'fournisseur_indisponible'
  | 'modele_invalide'
  | 'transcription_indisponible'
  | 'plafond_invalide'
  | 'modele_secours_inconnu'

/** Erreur de validation à l'écriture de la configuration. Ne contient jamais de clé. */
export class ErreurConfigMedicAssist extends Error {
  readonly code: CodeErreurConfig

  constructor(code: CodeErreurConfig, message: string) {
    super(message)
    this.name = 'ErreurConfigMedicAssist'
    this.code = code
    Object.setPrototypeOf(this, ErreurConfigMedicAssist.prototype)
  }
}

/**
 * Levée quand la clé du fournisseur choisi manque (le message ne cite aucune clé).
 * Définie ici pour éviter un cycle d'import ; `agent/erreurs.ts` la réexporte.
 */
export class ErreurFournisseurAbsent extends Error {
  constructor(message = 'Fournisseur IA indisponible') {
    super(message)
    this.name = 'ErreurFournisseurAbsent'
    Object.setPrototypeOf(this, ErreurFournisseurAbsent.prototype)
  }
}
