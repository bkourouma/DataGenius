/**
 * GET /api/medic-assist/jeux/[id]?recalculer=1&page=1&taille=100
 *
 * Lit un jeu de données (propriétaire, partage d'artefact ou de conversation, artefact
 * épinglé). Le contrôle d'accès est dans la requête de lecture de `lireJeu` ; ici : garde
 * Medic Assist, validation des paramètres, traduction des erreurs. Absent et inaccessible
 * donnent la même 404.
 */

import { NextRequest, NextResponse } from 'next/server'

import { IdentifiantSchema, JeuQuerySchema } from '@/lib/medic-assist/contrats'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import type { CodeErreurLot6 } from '@/lib/medic-assist/admin/codes-erreur'
import { CODE_LIMITE_DEBIT_DONNEES } from '@/lib/medic-assist/donnees/limite-debit'
import { lireJeu } from '@/lib/medic-assist/donnees/outils-donnees'
import { ErreurDonnees } from '@/lib/medic-assist/donnees/types'

export const dynamic = 'force-dynamic'

type ParamsRoute = { id: string } | Promise<{ id: string }>

const ENTETES = { 'Cache-Control': 'private, no-store' }

/**
 * Erreurs au format { error: <code>, message } des routes voisines : `error` est un code de
 * CODES_ERREUR_LOT_6 que l'interface traduit (medicAssistAdmin.erreursApi.<code>, 6 langues),
 * `message` un repli anglais court, sans donnée.
 */
type CodeErreurJeux = Extract<
  CodeErreurLot6,
  | 'validationInvalide'
  | 'jeuIntrouvable'
  | 'accesRefuse'
  | 'jeuNonRecalculable'
  | 'roleLectureAbsent'
  | typeof CODE_LIMITE_DEBIT_DONNEES
  | 'erreurServeur'
>

function repondre(
  corps: unknown,
  status = 200,
  entetes: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(corps, { status, headers: { ...ENTETES, ...entetes } })
}

function erreur(
  status: number,
  code: CodeErreurJeux,
  message: string,
  extra: { details?: unknown; entetes?: Record<string, string> } = {}
): NextResponse {
  const corps =
    extra.details === undefined
      ? { error: code, message }
      : { error: code, message, details: extra.details }
  return repondre(corps, status, extra.entetes)
}

export async function GET(request: NextRequest, { params }: { params: ParamsRoute }) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) {
    garde.reponse.headers.set('Cache-Control', ENTETES['Cache-Control'])
    return garde.reponse
  }

  const { id } = await params
  if (!IdentifiantSchema.safeParse(id).success) {
    return erreur(400, 'validationInvalide', 'Invalid dataset id.', {
      details: [{ parametre: 'id', message: 'invalid' }],
    })
  }

  const brut = Object.fromEntries(request.nextUrl.searchParams.entries())
  const requete = JeuQuerySchema.safeParse(brut)
  if (!requete.success) {
    return erreur(400, 'validationInvalide', 'Invalid query parameters.', {
      details: requete.error.issues.map(i => ({
        parametre: i.path.join('.'),
        message: i.message,
      })),
    })
  }

  try {
    const jeu = await lireJeu(id, garde.contexte, {
      recalculer: requete.data.recalculer,
      page: requete.data.page,
      taille: requete.data.taille,
    })
    return repondre(jeu)
  } catch (e) {
    if (e instanceof ErreurDonnees) {
      // `lireJeu` rend la même erreur `introuvable` pour un jeu absent ou inaccessible.
      if (e.code === 'introuvable') return erreur(404, 'jeuIntrouvable', 'Dataset not found.')
      if (e.code === 'acces_refuse') return erreur(403, 'accesRefuse', 'Access denied.')
      if (e.code === 'limite_debit_donnees') {
        const secondes = Math.ceil((e.reessayerDansMs ?? 60_000) / 1000)
        return erreur(
          429,
          CODE_LIMITE_DEBIT_DONNEES,
          'Too many recalculations. Try again in a few minutes.',
          { entetes: { 'Retry-After': String(secondes) } }
        )
      }
      // Défaut de configuration du serveur (rôle de lecture absent), pas de la demande.
      if (e.code === 'role_lecture_absent') {
        return erreur(503, 'roleLectureAbsent', 'Data service temporarily unavailable.')
      }
      return erreur(422, 'jeuNonRecalculable', 'This dataset cannot be recalculated.', {
        details: { code: e.code },
      })
    }
    // Ni message ni valeur dans le journal : ils pourraient contenir des données.
    console.error('[medic-assist/jeux] erreur interne :', e instanceof Error ? e.name : typeof e)
    return erreur(500, 'erreurServeur', 'Internal error.')
  }
}
