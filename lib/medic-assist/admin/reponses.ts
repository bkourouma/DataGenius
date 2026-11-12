/**
 * Reponses d'erreur communes des routes du lot 6, au format { error, message }.
 * `error` est TOUJOURS un code de codes-erreur.ts (l'interface le traduit) ; `message` est
 * un repli anglais court, sans donnee sensible.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import type { CodeErreurLot6 } from './codes-erreur'

export function erreurApi(
  status: number,
  error: CodeErreurLot6,
  message: string,
  details?: unknown
) {
  return NextResponse.json(
    details === undefined ? { error, message } : { error, message, details },
    { status }
  )
}

export function erreurValidation(erreur: z.ZodError) {
  return erreurApi(400, 'validationInvalide', 'Invalid request.', z.flattenError(erreur))
}

/** Lit un corps JSON ; null si le corps est absent ou illisible. */
export async function lireCorpsJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/** Reponse jamais mise en cache : ces donnees sont propres a l'administrateur. */
export const ENTETES_SANS_CACHE = { 'Cache-Control': 'no-store' }
