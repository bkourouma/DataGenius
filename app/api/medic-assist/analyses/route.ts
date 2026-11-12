/**
 * GET  /api/medic-assist/analyses?q=&page=&taille=&artefactId= : Mes analyses.
 * POST /api/medic-assist/analyses { artefactId } : enregistre (201 si nouveau, 200 sinon).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { enregistrerAnalyse, listerAnalyses } from '@/lib/medic-assist/suivi/analyses'
import { lirePagination, reponseErreur } from '@/lib/medic-assist/suivi/erreurs'

export const dynamic = 'force-dynamic'

const schemaCorps = z.object({ artefactId: z.string().min(1).max(200) })

export async function GET(request: NextRequest) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const params = request.nextUrl.searchParams
    const { page, taille } = lirePagination(params)
    const recherche = params.get('q')?.trim().slice(0, 200)
    const artefactId = params.get('artefactId')?.trim()
    const { lignes, total } = await listerAnalyses(garde.contexte, {
      ...(recherche ? { recherche } : {}),
      ...(artefactId ? { artefactId } : {}),
      page,
      taille,
    })
    return NextResponse.json({ data: lignes, total })
  } catch (error) {
    return reponseErreur(error, 'GET /api/medic-assist/analyses')
  }
}

export async function POST(request: NextRequest) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const corps = schemaCorps.parse(await request.json().catch(() => null))
    const { cree } = await enregistrerAnalyse(garde.contexte, corps.artefactId)
    return NextResponse.json(
      { data: { artefactId: corps.artefactId, cree } },
      { status: cree ? 201 : 200 }
    )
  } catch (error) {
    return reponseErreur(error, 'POST /api/medic-assist/analyses')
  }
}
