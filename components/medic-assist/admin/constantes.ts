/**
 * Constantes de l'interface d'administration de Medic Assist.
 */

import type { FournisseurTranscription } from './imports-lot0';

/** Topic du guide de l'ecran (route /dashboard/admin/medic-assist). */
export const TOPIC_GUIDE_ADMIN_MEDIC_ASSIST = 'administration.medic-assist-admin';

export const ONGLETS = ['configuration', 'usages', 'avis'] as const;
export type OngletAdmin = (typeof ONGLETS)[number];
export const ONGLET_PAR_DEFAUT: OngletAdmin = 'configuration';

/** Parametre d'URL qui memorise l'onglet. */
export const PARAMETRE_ONGLET = 'onglet';

export function ongletValide(valeur: string | null | undefined): OngletAdmin {
  return (ONGLETS as readonly string[]).includes(valeur ?? '')
    ? (valeur as OngletAdmin)
    : ONGLET_PAR_DEFAUT;
}

export const URL_CONFIG = '/api/medic-assist/admin/config';
export const URL_TESTER = '/api/medic-assist/admin/tester';
export const URL_USAGES = '/api/medic-assist/admin/usages';
export const URL_AVIS = '/api/medic-assist/admin/avis';

/** Page de l'assistant, lue par le lot 3 (parametre `c` = identifiant de conversation). */
export const CHEMIN_MEDIC_ASSIST = '/medic-assist';
export const PARAMETRE_CONVERSATION = 'c';

/** Taille d'une page d'avis demandee au serveur. */
export const TAILLE_PAGE_AVIS = 20;

/**
 * Modeles de transcription proposes en suggestion (copie de
 * MODELE_TRANSCRIPTION_OPENAI / _GOOGLE de lib/medic-assist/transcription/transcrire.ts,
 * qui importe le SDK et ne se charge pas cote client).
 */
export const SUGGESTION_MODELE_TRANSCRIPTION: Record<FournisseurTranscription, string> = {
  openai: 'gpt-4o-mini-transcribe',
  google: 'gemini-2.5-flash',
};

/** Format d'un identifiant de modele accepte par le serveur (ConfigAdminCorpsSchema). */
export const FORMAT_IDENTIFIANT_MODELE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
export const LONGUEUR_MAX_IDENTIFIANT_MODELE = 100;
