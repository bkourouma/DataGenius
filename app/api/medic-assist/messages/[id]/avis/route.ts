/**
 * Avis sur une réponse de Medic Assist (lot 1).
 *
 * POST /api/medic-assist/messages/[id]/avis
 * Corps : { valeur: 'positif' | 'negatif' | null, commentaire? } ou { note: 1 | -1, commentaire? }.
 * `valeur: null` retire l'avis. Un seul avis par utilisateur et par message (le dernier remplace).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import {
  AvisCorpsEntreeSchema,
  enregistrerAvis,
  nomErreur,
  normaliserAvis,
} from '@/lib/medic-assist/agent/conversations'

export const dynamic = 'force-dynamic'

interface Contexte {
  params: { id: string }
}

/**
 * POST /api/medic-assist/messages/[id]/avis
 * Réponse 200 : AvisDto. Erreurs : 400 validation, 401/403 garde, 404 si le message n'est pas un
 * message de l'assistant d'une conversation visible du lecteur, 500.
 */
export async function POST(request: NextRequest, { params }: Contexte) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'validation', message: 'Invalid JSON body' }, { status: 400 })
  }
  const corps = AvisCorpsEntreeSchema.safeParse(json)
  if (!corps.success) {
    return NextResponse.json(
      { error: 'validation', message: 'Invalid request', details: z.flattenError(corps.error) },
      { status: 400 }
    )
  }

  try {
    const avis = await enregistrerAvis(garde.contexte, params.id, normaliserAvis(corps.data))
    if (!avis) {
      return NextResponse.json(
        { error: 'not_found', message: 'Message not found' },
        { status: 404 }
      )
    }
    return NextResponse.json(avis)
  } catch (erreur) {
    console.error('[medic-assist/messages/avis]', nomErreur(erreur))
    return NextResponse.json({ error: 'internal', message: 'Internal error' }, { status: 500 })
  }
}
