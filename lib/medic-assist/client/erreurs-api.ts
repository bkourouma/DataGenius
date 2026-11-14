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
  /** Messages des garde-fous (`medicAssist.gardeFous.api`) : essayes quand le premier n'a pas le code. */
  traducteurSecours?: TraducteurErreursApi | null,
): string {
  const code = codeErreurApi(erreur)
  if (!code) return repli
  for (const t of [traducteur, traducteurSecours]) {
    if (!t) continue
    try {
      if (t.has(code)) return t(code) || repli
    } catch {
      // namespace absent ou message mal forme : on passe au suivant, puis au repli
    }
  }
  return repli
}

/**
 * Fonction `(erreur, repli) => message` branchee sur le namespace des erreurs d'API, avec les
 * messages des garde-fous (`limiteDebit`, `quotaEpuise`) en secours.
 */
export function useMessageErreurApi(): (erreur: unknown, repli: string) => string {
  const t = useTranslations('medicAssistAdmin.erreursApi' as never) as unknown as TraducteurErreursApi
  const tGardeFous = useTranslations('medicAssist.gardeFous.api' as never) as unknown as TraducteurErreursApi
  return useCallback(
    (erreur: unknown, repli: string) => messageErreurApi(erreur, t, repli, tGardeFous),
    [t, tGardeFous],
  )
}
