/**
 * Appels HTTP de l'administration de Medic Assist.
 *
 * Les routes repondent en { error, message } (code stable dans `error`). L'ecran
 * ne relaie jamais le message brut du serveur : il le traduit a partir du code
 * (voir `useMessageErreur`).
 */

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { CODES_ERREUR_LOT_6, type CodeErreurLot6 } from '@/lib/medic-assist/admin/codes-erreur';

export class ErreurAppel extends Error {
  readonly statut: number;
  readonly code: string;

  constructor(statut: number, code: string, message: string) {
    super(message);
    this.name = 'ErreurAppel';
    this.statut = statut;
    this.code = code;
  }
}

/** Lit le corps JSON d'une reponse sans jamais lever. */
async function lireJson(reponse: Response): Promise<unknown> {
  try {
    return await reponse.json();
  } catch {
    return null;
  }
}

async function erreurDepuisReponse(reponse: Response): Promise<ErreurAppel> {
  const corps = (await lireJson(reponse)) as { error?: unknown; message?: unknown } | null;
  const code = typeof corps?.error === 'string' ? corps.error : '';
  const message = typeof corps?.message === 'string' ? corps.message : '';
  return new ErreurAppel(reponse.status, code, message);
}

/** GET/PUT/POST JSON. Leve ErreurAppel si le serveur refuse. */
export async function appelerJson<T>(
  url: string,
  init?: RequestInit & { signal?: AbortSignal }
): Promise<T> {
  const reponse = await fetch(url, init);
  if (!reponse.ok) throw await erreurDepuisReponse(reponse);
  return (await lireJson(reponse)) as T;
}

/** Telecharge un fichier : renvoie le blob et le nom propose par le serveur, s'il y en a un. */
export async function telecharger(url: string): Promise<{ blob: Blob; nomFichier: string | null }> {
  const reponse = await fetch(url);
  if (!reponse.ok) throw await erreurDepuisReponse(reponse);
  const disposition = reponse.headers.get('Content-Disposition') ?? '';
  const correspondance = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  let nomFichier: string | null = null;
  if (correspondance) {
    try {
      nomFichier = decodeURIComponent(correspondance[1]);
    } catch {
      nomFichier = correspondance[1];
    }
  }
  return { blob: await reponse.blob(), nomFichier };
}

/** Declenche l'enregistrement d'un blob par le navigateur. */
export function enregistrerBlob(blob: Blob, nomFichier: string) {
  const adresse = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = adresse;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(adresse);
}

/**
 * Message affichable pour une erreur d'appel : traduit par code stable
 * (medicAssistAdmin.erreursApi.<code>), puis par statut HTTP, sinon message generique.
 * Jamais de texte technique du serveur.
 */
export function useMessageErreur() {
  const t = useTranslations('medicAssistAdmin');
  return useCallback(
    (erreur: unknown): string => {
      if (erreur instanceof ErreurAppel) {
        // Le code vient du serveur : on ne traduit que ceux de la liste partagee.
        if ((CODES_ERREUR_LOT_6 as readonly string[]).includes(erreur.code)) {
          return t(`erreursApi.${erreur.code as CodeErreurLot6}`);
        }
        if (erreur.statut === 401) return t('erreurs.nonAutorise');
        if (erreur.statut === 403) return t('erreurs.interdit');
        return t('erreurs.generique');
      }
      if (erreur instanceof TypeError) return t('erreurs.reseau');
      return t('erreurs.generique');
    },
    [t]
  );
}

/** Vrai pour l'annulation volontaire d'une requete (changement de periode, demontage). */
export function estAnnulation(erreur: unknown): boolean {
  return erreur instanceof DOMException && erreur.name === 'AbortError';
}
