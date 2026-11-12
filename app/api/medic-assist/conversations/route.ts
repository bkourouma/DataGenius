/**
 * Conversations de Medic Assist (lot 1).
 *
 * GET  /api/medic-assist/conversations : liste de l'utilisateur (recherche, archivées, curseur)
 * POST /api/medic-assist/conversations : crée une conversation vide
 *
 * Accès : siège (garde exigerMedicAssist). Le service ne lit que les conversations du lecteur.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import {
  creerConversation,
  listerConversations,
  nomErreur,
} from '@/lib/medic-assist/agent/conversations'
import {
  CreerConversationCorpsSchema,
  ListeConversationsQuerySchema,
} from '@/lib/medic-assist/contrats/api'

export const dynamic = 'force-dynamic'

function reponseValidation(erreur: z.ZodError) {
  return NextResponse.json(
    { error: 'validation', message: 'Invalid request', details: z.flattenError(erreur) },
    { status: 400 }
  )
}

function reponseInterne(erreur: unknown) {
  console.error('[medic-assist/conversations]', nomErreur(erreur))
  return NextResponse.json({ error: 'internal', message: 'Internal error' }, { status: 500 })
}

/**
 * GET /api/medic-assist/conversations
 * Query : recherche, archivees (1|true|0|false), curseur, taille.
 * Réponse 200 : ListeConversationsDto. Erreurs : 400 validation, 401/403 garde, 500.
 */
export async function GET(request: NextRequest) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  const brut = Object.fromEntries(request.nextUrl.searchParams.entries())
  const requete = ListeConversationsQuerySchema.safeParse(brut)
  if (!requete.success) return reponseValidation(requete.error)

  try {
    const liste = await listerConversations(garde.contexte, requete.data)
    return NextResponse.json(liste)
  } catch (erreur) {
    return reponseInterne(erreur)
  }
}

/**
 * POST /api/medic-assist/conversations
 * Corps : { titre? }. Réponse 201 : ConversationResumeDto.
 * Erreurs : 400 validation, 401/403 garde, 500.
 */
export async function POST(request: NextRequest) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  let json: unknown = {}
  try {
    const texte = await request.text()
    json = texte.trim() ? JSON.parse(texte) : {}
  } catch {
    return NextResponse.json({ error: 'validation', message: 'Invalid JSON body' }, { status: 400 })
  }
  const corps = CreerConversationCorpsSchema.safeParse(json)
  if (!corps.success) return reponseValidation(corps.error)

  try {
    const conversation = await creerConversation(garde.contexte, corps.data)
    return NextResponse.json(conversation, { status: 201 })
  } catch (erreur) {
    return reponseInterne(erreur)
  }
}
