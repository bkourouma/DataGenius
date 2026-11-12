/**
 * Erreurs metier du suivi et leur traduction en reponse HTTP.
 *
 * Les routes renvoient `{ error: <code>, message: <texte technique> }` : le client
 * traduit le CODE (messages medicAssistSuivi.erreurs.<code>), jamais le message.
 */

import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

export const CODES_ERREUR_SUIVI = {
  introuvable: 404,
  invalide: 400,
  interdit: 403,
  conflit: 409,
  destinataire_invalide: 400,
  /** Seul le proprietaire d'un artefact le partage, l'envoie, le notifie ou le programme. */
  artefact_non_proprietaire: 403,
  export_impossible: 502,
} as const
export type CodeErreurSuivi = keyof typeof CODES_ERREUR_SUIVI

export class ErreurSuivi extends Error {
  readonly code: CodeErreurSuivi
  constructor(code: CodeErreurSuivi, message?: string) {
    super(message ?? code)
    this.name = 'ErreurSuivi'
    this.code = code
  }
  get statut(): number {
    return CODES_ERREUR_SUIVI[this.code]
  }
}

/**
 * Nom (et code, s'il existe) d'une erreur pour le journal : jamais l'objet
 * entier, dont le message ou la cause peuvent porter une requete SQL ou des donnees.
 */
export function nomErreur(error: unknown): string {
  if (!(error instanceof Error)) return 'ErreurInconnue'
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' || typeof code === 'number' ? `${error.name} (${code})` : error.name
}

/** Convertit n'importe quelle erreur en reponse JSON ; journalise les erreurs inattendues. */
export function reponseErreur(error: unknown, route: string): NextResponse {
  if (error instanceof ErreurSuivi) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.statut })
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: 'invalide', message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 }
    )
  }
  console.error(`[medic-assist] ${route} :`, nomErreur(error))
  return NextResponse.json({ error: 'interne', message: 'Erreur interne' }, { status: 500 })
}

/** Page et taille depuis l'URL, bornees (defaut 1 / 50, taille au plus 200). */
export function lirePagination(params: URLSearchParams): { page: number; taille: number } {
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1)
  const brute = Math.floor(Number(params.get('taille'))) || 50
  return { page, taille: Math.min(200, Math.max(1, brute)) }
}
