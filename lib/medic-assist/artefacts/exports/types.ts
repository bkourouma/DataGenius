/**
 * Contrat interne des exports serveur : ce que `preparer-export.ts` fournit à chaque
 * générateur (xlsx, csv, pdf, pptx). Les générateurs ne lisent ni la base ni les ports :
 * tout ce dont ils ont besoin est dans `ExportPrepare`.
 */

import type { Locale } from '@/i18n/config';
import {
  FORMATS_EXPORT,
  type FormatExport,
  type GraphiqueSpec,
  type Provenance,
} from '@/lib/medic-assist/contrats';
import type { IndicateurResolu, JeuClient, ModeleTableau, Traducteur } from '../types-rendu';

export { FORMATS_EXPORT, type FormatExport };

export const TYPES_MIME: Record<FormatExport, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export type BlocExport =
  | { type: 'texte'; markdown: string }
  | { type: 'tableau'; titre: string; sousTitre?: string; modele: ModeleTableau }
  | {
      type: 'graphique';
      titre: string;
      sousTitre?: string;
      spec: GraphiqueSpec;
      /** Données COMPLÈTES du jeu (pas l'aperçu). */
      jeu: JeuClient;
      /** Le même jeu mis en tableau (pour le tableau natif d'une diapositive, ou le repli). */
      modele: ModeleTableau;
    }
  | { type: 'indicateurs'; titre: string; sousTitre?: string; indicateurs: IndicateurResolu[] };

export interface ExportPrepare {
  titre: string;
  sousTitre?: string;
  /** Langue de l'interface de la personne qui exporte. */
  locale: Locale;
  rtl: boolean;
  /** Traducteur du namespace medicAssistArtefacts dans `locale`. */
  traduire: Traducteur;
  /** Pour un artefact simple : un seul bloc. Pour un document : l'ordre de lecture. */
  blocs: BlocExport[];
  /** Une provenance par jeu de données référencé (sans doublon). Le SQL n'est JAMAIS exporté. */
  provenances: Provenance[];
  /**
   * Lignes du bandeau d'en-tête : source, période, périmètre (dans cet ordre, absentes
   * si inconnues), déjà traduites.
   */
  lignesContexte: string[];
  exporteLe: Date;
  /** Nom affiché de la personne qui exporte (jamais son id). */
  exportePar?: string;
}

export interface ResultatExport {
  buffer: Buffer;
  /** Nom lisible, titre + date, sans caractère interdit : « CA par pays 2026-11-02.xlsx ». */
  nomFichier: string;
  typeMime: string;
}
