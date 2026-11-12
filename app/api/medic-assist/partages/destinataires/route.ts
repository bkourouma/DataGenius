/**
 * GET /api/medic-assist/partages/destinataires?q=... ou ?ids=a,b : comptes actifs
 * ayant acces a Medic Assist (selecteur d'utilisateurs, resolution des noms).
 */

import { NextRequest, NextResponse } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { reponseErreur } from '@/lib/medic-assist/suivi/erreurs'
import { rechercherComptes } from '@/lib/medic-assist/suivi/partages'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const params = request.nextUrl.searchParams
    const ids = (params.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    const recherche = params.get('q')?.trim().slice(0, 100)
    const comptes = await rechercherComptes(garde.contexte, {
      ...(recherche ? { recherche } : {}),
      ...(ids.length ? { ids } : {}),
    })
    return NextResponse.json({ data: comptes })
  } catch (error) {
    return reponseErreur(error, 'GET /api/medic-assist/partages/destinataires')
  }
}
