/**
 * Une conversation de Medic Assist (lot 1).
 *
 * GET    /api/medic-assist/conversations/[id] : détail (propriétaire, ou lecture seule si partagée)
 * PATCH  /api/medic-assist/conversations/[id] : titre, épinglage, archivage (propriétaire)
 * DELETE /api/medic-assist/conversations/[id] : suppression (propriétaire)
 *
 * Une conversation inexistante ou qui n'est pas au lecteur donne toujours 404, jamais 403.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import {
  finaliserSuppressionPiecesJointes,
  lireConversation,
  modifierConversation,
  nomErreur,
  supprimerConversation,
} from '@/lib/medic-assist/agent/conversations'
import { ModifierConversationCorpsSchema } from '@/lib/medic-assist/contrats/api'

export const dynamic = 'force-dynamic'

interface Contexte {
  params: { id: string }
}

const introuvable = () =>
  NextResponse.json({ error: 'not_found', message: 'Conversation not found' }, { status: 404 })

function reponseInterne(erreur: unknown) {
  console.error('[medic-assist/conversations/[id]]', nomErreur(erreur))
  return NextResponse.json({ error: 'internal', message: 'Internal error' }, { status: 500 })
}

/**
 * GET /api/medic-assist/conversations/[id]
 * Réponse 200 : ConversationDetailDto (`lectureSeule: true` pour un lecteur par partage).
 * Erreurs : 401/403 garde, 404 introuvable ou non accessible, 500.
 */
export async function GET(_request: NextRequest, { params }: Contexte) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  try {
    const detail = await lireConversation(garde.contexte, params.id)
    return detail ? NextResponse.json(detail) : introuvable()
  } catch (erreur) {
    return reponseInterne(erreur)
  }
}

/**
 * PATCH /api/medic-assist/conversations/[id]
 * Corps : { titre?, epinglee?, archivee? } (un champ au moins). Réponse 200 : ConversationResumeDto.
 * Erreurs : 400 validation, 401/403 garde, 404 (aussi pour un lecteur par partage), 500.
 */
export async function PATCH(request: NextRequest, { params }: Contexte) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'validation', message: 'Invalid JSON body' }, { status: 400 })
  }
  const corps = ModifierConversationCorpsSchema.safeParse(json)
  if (!corps.success) {
    return NextResponse.json(
      { error: 'validation', message: 'Invalid request', details: z.flattenError(corps.error) },
      { status: 400 }
    )
  }

  try {
    const resume = await modifierConversation(garde.contexte, params.id, corps.data)
    return resume ? NextResponse.json(resume) : introuvable()
  } catch (erreur) {
    return reponseInterne(erreur)
  }
}

/**
 * DELETE /api/medic-assist/conversations/[id]
 * Supprime la conversation, ses messages et actions, puis les pièces jointes (fichiers et lignes).
 * Réponse 204. Erreurs : 401/403 garde, 404 (aussi pour un lecteur par partage), 500.
 */
export async function DELETE(_request: NextRequest, { params }: Contexte) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  try {
    const resultat = await supprimerConversation(garde.contexte, params.id)
    if (!resultat) return introuvable()
    await finaliserSuppressionPiecesJointes(garde.contexte, resultat.piecesJointesIds)
    return new NextResponse(null, { status: 204 })
  } catch (erreur) {
    return reponseInterne(erreur)
  }
}
