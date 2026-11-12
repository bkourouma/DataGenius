'use client';

/**
 * Appels HTTP de la page « Mes analyses » et des epingles du tableau de bord.
 * Types importes en `import type` uniquement : aucun code serveur dans le client.
 */

import { appeler } from './api-client';
import type { AnalyseResumeJson } from '@/lib/medic-assist/suivi/analyses';
import type { EpingleJson } from '@/lib/medic-assist/suivi/epingles';
import type { PartageEnvoyeJson, PartageRecuJson } from '@/lib/medic-assist/suivi/partages';
import type { RapportProgrammeJson } from '@/lib/medic-assist/suivi/rapports-programmes';
import type { TacheJson } from '@/lib/medic-assist/suivi/types';

function enJson(methode: string, corps: unknown): RequestInit {
  return {
    method: methode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  };
}

export const TAILLE_PAGE = 24;

export async function listerAnalysesApi(
  options: { q: string; page: number },
  signal?: AbortSignal
): Promise<{ data: AnalyseResumeJson[]; total: number }> {
  const params = new URLSearchParams({ page: String(options.page), taille: String(TAILLE_PAGE) });
  if (options.q.trim()) params.set('q', options.q.trim());
  const r = await appeler<{ data: AnalyseResumeJson[]; total?: number }>(`/analyses?${params}`, {
    signal,
  });
  return { data: r.data ?? [], total: r.total ?? r.data?.length ?? 0 };
}

export async function retirerAnalyseApi(artefactId: string): Promise<void> {
  await appeler(`/analyses/${encodeURIComponent(artefactId)}`, { method: 'DELETE' });
}

export async function listerPartagesApi(
  sens: 'recus' | 'envoyes',
  page: number,
  signal?: AbortSignal
): Promise<{ data: (PartageRecuJson | PartageEnvoyeJson)[]; total: number }> {
  const params = new URLSearchParams({ sens, page: String(page), taille: String(TAILLE_PAGE) });
  const r = await appeler<{ data: (PartageRecuJson | PartageEnvoyeJson)[]; total?: number }>(
    `/partages?${params}`,
    { signal }
  );
  return { data: r.data ?? [], total: r.total ?? r.data?.length ?? 0 };
}

/** Retire un partage (expediteur : retirer ; destinataire : ne plus voir). */
export async function retirerPartageApi(partageId: string): Promise<void> {
  await appeler(`/partages/${encodeURIComponent(partageId)}`, { method: 'DELETE' });
}

export async function listerTachesApi(signal?: AbortSignal): Promise<TacheJson[]> {
  const r = await appeler<{ data: TacheJson[] }>('/taches', { signal });
  return r.data ?? [];
}

export async function changerEtatTacheApi(id: string, terminee: boolean): Promise<TacheJson> {
  const r = await appeler<{ data: TacheJson }>('/taches', enJson('PATCH', { id, terminee }));
  return r.data;
}

export async function listerRapportsApi(signal?: AbortSignal): Promise<RapportProgrammeJson[]> {
  const r = await appeler<{ data: RapportProgrammeJson[] }>('/rapports-programmes', { signal });
  return r.data ?? [];
}

export async function changerActifRapportApi(id: string, actif: boolean): Promise<void> {
  await appeler(`/rapports-programmes/${encodeURIComponent(id)}`, enJson('PATCH', { actif }));
}

export async function supprimerRapportApi(id: string): Promise<void> {
  await appeler(`/rapports-programmes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listerEpinglesApi(signal?: AbortSignal): Promise<EpingleJson[]> {
  const r = await appeler<{ data: EpingleJson[] }>('/epingles', { signal });
  return r.data ?? [];
}

export async function desepinglerApi(artefactId: string): Promise<void> {
  await appeler(`/epingles?artefactId=${encodeURIComponent(artefactId)}`, { method: 'DELETE' });
}
