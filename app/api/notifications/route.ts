/**
 * GET /api/notifications?limite=N : dernières notifications in_app de l'utilisateur connecté
 * et nombre total de non lues.
 */

import { NextRequest, NextResponse } from 'next/server'

import { exigerSession } from '@/lib/auth/garde-api'
import { journal } from '@/lib/journal'
import { LIMITE_DEFAUT, LIMITE_MAX, listerNotifications } from '@/lib/notifications/cloche'

export const dynamic = 'force-dynamic'

const SANS_CACHE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  const garde = await exigerSession()
  if (!garde.ok) return garde.reponse
  const brut = request.nextUrl.searchParams.get('limite')
  let limite = LIMITE_DEFAUT
  if (brut !== null && /^\d+$/.test(brut.trim())) {
    limite = Math.min(Math.max(Number(brut), 1), LIMITE_MAX)
  }
  try {
    const data = await listerNotifications(garde.session.user.id, limite)
    return NextResponse.json({ data }, { headers: SANS_CACHE })
  } catch (error) {
    journal.erreur('Lecture des notifications impossible', {
      domaine: 'notifications',
      code: 'lecture_impossible',
      erreur: error,
    })
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500, headers: SANS_CACHE })
  }
}
