'use client';

/**
 * Appels HTTP du suivi Medic Assist (actions, analyses, epingles, partages,
 * rapports programmes) et affichage des erreurs.
 *
 * Chaque fonction leve une `ErreurApi` portant le `code` renvoye par le serveur
 * (`{ error: <code>, message }`) : l'interface traduit le CODE, jamais le
 * message technique.
 */

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { useToast } from '@/hooks/use-toast';
import type { CompteJson } from '@/lib/medic-assist/suivi/types';
import type { ActionProposee, FormatEnvoi, FrequenceRapport } from '@/lib/medic-assist/contrats';

export const CODES_ERREUR_API = [
  'introuvable',
  'invalide',
  'interdit',
  'conflit',
  'destinataire_invalide',
  'export_impossible',
  'artefact_non_proprietaire',
  'interne',
  'reseau',
] as const;
export type CodeErreurApi = (typeof CODES_ERREUR_API)[number];

export function estCodeErreurApi(valeur: unknown): valeur is CodeErreurApi {
  return typeof valeur === 'string' && (CODES_ERREUR_API as readonly string[]).includes(valeur);
}

export class ErreurApi extends Error {
  readonly code: CodeErreurApi;
  readonly statut: number;
  constructor(code: CodeErreurApi, statut = 0, message?: string) {
    super(message ?? code);
    this.name = 'ErreurApi';
    this.code = code;
    this.statut = statut;
  }
}

/** Code d'erreur d'une exception quelconque (repli : `interne`). */
export function codeErreurDe(erreur: unknown): CodeErreurApi {
  return erreur instanceof ErreurApi ? erreur.code : 'interne';
}

const RACINE = '/api/medic-assist';

/** Appel JSON de l'API Medic Assist ; leve une `ErreurApi` (code serveur ou `reseau`). */
export async function appeler<T>(chemin: string, init?: RequestInit): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(`${RACINE}${chemin}`, init);
  } catch (erreur) {
    // Une requete annulee volontairement (anti-rebond) doit rester une AbortError.
    if (erreur instanceof DOMException && erreur.name === 'AbortError') throw erreur;
    throw new ErreurApi('reseau');
  }

  let corps: unknown = null;
  try {
    corps = await reponse.json();
  } catch {
    corps = null;
  }

  if (!reponse.ok) {
    const code = (corps as { error?: unknown } | null)?.error;
    throw new ErreurApi(
      estCodeErreurApi(code) ? code : 'interne',
      reponse.status,
      (corps as { message?: string } | null)?.message
    );
  }
  return corps as T;
}

function enJson(methode: string, corps?: unknown): RequestInit {
  return {
    method: methode,
    headers: { 'Content-Type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  };
}

// --------------------------------------------------------------------------- actions

export interface ParametresConfirmation {
  destinataires?: string[];
  echeance?: string;
  priorite?: 'basse' | 'normale' | 'haute';
  assigneA?: string;
  message?: string;
  formats?: FormatEnvoi[];
  frequence?: FrequenceRapport;
  heure?: string;
  jourSemaine?: number;
  jourMois?: number;
}

export async function lireAction(id: string, signal?: AbortSignal): Promise<ActionProposee> {
  const r = await appeler<{ data: ActionProposee }>(`/actions/${encodeURIComponent(id)}`, {
    signal,
  });
  return r.data;
}

export async function confirmerAction(
  id: string,
  parametres?: ParametresConfirmation
): Promise<ActionProposee> {
  const r = await appeler<{ data: ActionProposee }>(
    `/actions/${encodeURIComponent(id)}/confirmer`,
    enJson('POST', parametres && Object.keys(parametres).length > 0 ? { parametres } : {})
  );
  return r.data;
}

export async function annulerAction(id: string): Promise<ActionProposee> {
  const r = await appeler<{ data: ActionProposee }>(
    `/actions/${encodeURIComponent(id)}/annuler`,
    enJson('POST', {})
  );
  return r.data;
}

// --------------------------------------------------------------------------- droits

/** Vrai si je suis proprietaire de l'artefact (sinon : lecture et epinglage seulement). */
export async function estProprietaireArtefact(
  artefactId: string,
  signal?: AbortSignal
): Promise<boolean> {
  const r = await appeler<{ data?: { proprietaire?: unknown } }>(
    `/partages/droits?artefactId=${encodeURIComponent(artefactId)}`,
    { signal }
  );
  return r.data?.proprietaire === true;
}

// --------------------------------------------------------------------------- analyses

export async function analyseEnregistree(
  artefactId: string,
  signal?: AbortSignal
): Promise<boolean> {
  const r = await appeler<{ data: unknown[] }>(
    `/analyses?artefactId=${encodeURIComponent(artefactId)}`,
    { signal }
  );
  return Array.isArray(r.data) && r.data.length > 0;
}

export async function enregistrerAnalyse(artefactId: string): Promise<void> {
  await appeler('/analyses', enJson('POST', { artefactId }));
}

export async function retirerAnalyse(artefactId: string): Promise<void> {
  await appeler(`/analyses/${encodeURIComponent(artefactId)}`, { method: 'DELETE' });
}

// --------------------------------------------------------------------------- epingles

export async function artefactEpingle(artefactId: string, signal?: AbortSignal): Promise<boolean> {
  const r = await appeler<{ data: unknown[] }>(
    `/epingles?artefactId=${encodeURIComponent(artefactId)}`,
    { signal }
  );
  return Array.isArray(r.data) && r.data.length > 0;
}

export async function epinglerArtefact(artefactId: string): Promise<void> {
  await appeler('/epingles', enJson('POST', { artefactId }));
}

export async function desepinglerArtefact(artefactId: string): Promise<void> {
  await appeler(`/epingles?artefactId=${encodeURIComponent(artefactId)}`, { method: 'DELETE' });
}

// --------------------------------------------------------------------------- partages

export interface CorpsPartage {
  cible: { type: 'conversation' | 'artefact'; id: string };
  destinataires: string[];
  message?: string;
}

export async function partager(corps: CorpsPartage): Promise<number> {
  await appeler('/partages', enJson('POST', corps));
  return corps.destinataires.length;
}

export async function rechercherComptes(q: string, signal?: AbortSignal): Promise<CompteJson[]> {
  const r = await appeler<{ data: CompteJson[] }>(
    `/partages/destinataires?q=${encodeURIComponent(q)}`,
    { signal }
  );
  return r.data ?? [];
}

export async function resoudreComptes(ids: string[], signal?: AbortSignal): Promise<CompteJson[]> {
  if (ids.length === 0) return [];
  const r = await appeler<{ data: CompteJson[] }>(
    `/partages/destinataires?ids=${ids.map(encodeURIComponent).join(',')}`,
    { signal }
  );
  return r.data ?? [];
}

// --------------------------------------------------------------------------- rapports programmes

export interface CorpsRapportProgramme {
  artefactId: string;
  frequence: FrequenceRapport;
  jourSemaine?: number;
  jourMois?: number;
  heure: string;
  destinataires: string[];
  formats: FormatEnvoi[];
}

export async function programmerRapport(corps: CorpsRapportProgramme): Promise<void> {
  await appeler('/rapports-programmes', enJson('POST', corps));
}

// --------------------------------------------------------------------------- erreurs

/**
 * Affiche une erreur d'appel dans un toast destructif, avec le texte
 * `erreurs.<code>` (repli `erreurs.interne`). Une annulation volontaire de la
 * requete (AbortError) ne dit rien.
 */
export function useAfficherErreur(): (erreur: unknown) => void {
  const t = useTranslations('medicAssistSuivi');
  const { toast } = useToast();

  return useCallback(
    (erreur: unknown) => {
      if (erreur instanceof DOMException && erreur.name === 'AbortError') return;
      toast({
        variant: 'destructive',
        title: t('erreurs.titre'),
        description: t(`erreurs.${codeErreurDe(erreur)}`),
      });
    },
    [t, toast]
  );
}
