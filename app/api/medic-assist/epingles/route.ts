/**
 * GET    /api/medic-assist/epingles[?artefactId=] : epingles du tableau de bord.
 * POST   /api/medic-assist/epingles { artefactId } : epingle (201 si nouveau, 200 sinon).
 * DELETE /api/medic-assist/epingles?artefactId=X : desepingle.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import {
  desepinglerArtefact,
  epinglerArtefact,
  listerEpingles,
} from '@/lib/medic-assist/suivi/epingles'
import { ErreurSuivi, reponseErreur } from '@/lib/medic-assist/suivi/erreurs'

export const dynamic = 'force-dynamic'

const schemaCorps = z.object({ artefactId: z.string().min(1).max(200) })

export async function GET(request: NextRequest) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const artefactId = request.nextUrl.searchParams.get('artefactId')?.trim()
    const epingles = await listerEpingles(garde.contexte, artefactId ? { artefactId } : {})
    return NextResponse.json({ data: epingles })
  } catch (error) {
    return reponseErreur(error, 'GET /api/medic-assist/epingles')
  }
}

export async function POST(request: NextRequest) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const corps = schemaCorps.parse(await request.json().catch(() => null))
    const { cree } = await epinglerArtefact(garde.contexte, corps.artefactId)
    return NextResponse.json(
      { data: { artefactId: corps.artefactId, cree } },
      { status: cree ? 201 : 200 }
    )
  } catch (error) {
    return reponseErreur(error, 'POST /api/medic-assist/epingles')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const artefactId = request.nextUrl.searchParams.get('artefactId')?.trim()
    if (!artefactId) throw new ErreurSuivi('invalide', 'artefactId requis')
    await desepinglerArtefact(garde.contexte, artefactId)
    return NextResponse.json({ data: { ok: true } })
  } catch (error) {
    return reponseErreur(error, 'DELETE /api/medic-assist/epingles')
  }
}
