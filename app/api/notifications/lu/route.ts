/**
 * POST /api/notifications/lu { id } ou { tous: true } : marque lues les notifications
 * de l'utilisateur connecté. Un id inconnu ou d'un autre utilisateur donne 404.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { exigerSession } from '@/lib/auth/garde-api'
import { journal } from '@/lib/journal'
import { marquerLue, marquerToutesLues } from '@/lib/notifications/cloche'

export const dynamic = 'force-dynamic'

const SANS_CACHE = { 'Cache-Control': 'no-store' }

const schemaCorps = z.union([
  z.strictObject({ id: z.string().min(1).max(100) }),
  z.strictObject({ tous: z.literal(true) }),
])

export async function POST(request: NextRequest) {
  const garde = await exigerSession()
  if (!garde.ok) return garde.reponse
  const type = request.headers.get('content-type') ?? ''
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return NextResponse.json({ error: 'Type de contenu non pris en charge' }, { status: 415, headers: SANS_CACHE })
  }
  const corps = schemaCorps.safeParse(await request.json().catch(() => null))
  if (!corps.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400, headers: SANS_CACHE })
  }
  try {
    const userId = garde.session.user.id
    const resultat = 'id' in corps.data
      ? await marquerLue(userId, corps.data.id)
      : await marquerToutesLues(userId)
    if (!resultat) {
      return NextResponse.json({ error: 'Notification introuvable' }, { status: 404, headers: SANS_CACHE })
    }
    return NextResponse.json({ data: { nonLues: resultat.nonLues } }, { headers: SANS_CACHE })
  } catch (error) {
    journal.erreur('Marquage des notifications impossible', {
      domaine: 'notifications',
      code: 'marquage_impossible',
      erreur: error,
    })
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500, headers: SANS_CACHE })
  }
}
