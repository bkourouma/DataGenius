/**
 * GET  /api/medic-assist/rapports-programmes : mes rapports programmes.
 * POST /api/medic-assist/rapports-programmes : en programmer un (le dialogue
 * « Programmer » est lui-meme le clic de confirmation).
 */

import { NextRequest, NextResponse } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { ParametresProgrammerRapportSchema } from '@/lib/medic-assist/contrats'
import { reponseErreur } from '@/lib/medic-assist/suivi/erreurs'
import {
  creerRapportProgramme,
  listerRapports,
  rapportsEnJson,
} from '@/lib/medic-assist/suivi/rapports-programmes'

export const dynamic = 'force-dynamic'

export async function GET() {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse
  try {
    return NextResponse.json({ data: await listerRapports(garde.contexte) })
  } catch (error) {
    return reponseErreur(error, 'GET /api/medic-assist/rapports-programmes')
  }
}

export async function POST(request: NextRequest) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse
  try {
    const corps = ParametresProgrammerRapportSchema.parse(await request.json().catch(() => null))
    const rapport = await creerRapportProgramme(garde.contexte, corps)
    const [data] = await rapportsEnJson([rapport])
    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    return reponseErreur(error, 'POST /api/medic-assist/rapports-programmes')
  }
}
