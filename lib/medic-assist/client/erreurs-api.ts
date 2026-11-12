"use client"

/**
 * Erreurs des routes de Medic Assist qui repondent `{ error: <code>, message }`
 * (pieces jointes, transcription...). `appelApi` garde le champ `error` comme
 * message de l'`ErreurApiMedicAssist` : c'est le code. Il se traduit avec la cle
 * `medicAssistAdmin.erreursApi.<code>` quand elle existe ; sinon on affiche le repli.
 */

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { ErreurApiMedicAssist } from './api'

export const CODE_TRANSCRIPTION_INDISPONIBLE = 'transcriptionIndisponible'

const FORME_CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

/** Code d'erreur de l'API (ex. `transcriptionIndisponible`), ou null si ce n'en est pas un. */
export function codeErreurApi(erreur: unknown): string | null {
  if (!(erreur instanceof ErreurApiMedicAssist)) return null
  return FORME_CODE.test(erreur.message) ? erreur.message : null
}

export interface TraducteurErreursApi {
  has: (cle: string) => boolean
  (cle: string): string
}

/** Message traduit du code d'erreur, ou `repli` (jamais d'exception). */
export function messageErreurApi(
  erreur: unknown,
  traducteur: TraducteurErreursApi | null | undefined,
  repli: string,
): string {
  const code = codeErreurApi(erreur)
  if (!code || !traducteur) return repli
  try {
    if (traducteur.has(code)) return traducteur(code) || repli
  } catch {
    // namespace absent ou message mal forme : repli
  }
  return repli
}

/** Fonction `(erreur, repli) => message` branchee sur le namespace des erreurs d'API. */
export function useMessageErreurApi(): (erreur: unknown, repli: string) => string {
  const t = useTranslations('medicAssistAdmin.erreursApi' as never) as unknown as TraducteurErreursApi
  return useCallback((erreur: unknown, repli: string) => messageErreurApi(erreur, t, repli), [t])
}
