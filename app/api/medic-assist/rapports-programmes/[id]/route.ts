/**
 * GET | PATCH | DELETE /api/medic-assist/rapports-programmes/[id]
 * Le rapport d'un autre utilisateur est introuvable (404), jamais interdit.
 */

import { NextRequest, NextResponse } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { ModifierRapportProgrammeCorpsSchema } from '@/lib/medic-assist/contrats'
import { reponseErreur } from '@/lib/medic-assist/suivi/erreurs'
import {
  lireRapport,
  modifierRapport,
  supprimerRapport,
} from '@/lib/medic-assist/suivi/rapports-programmes'

export const dynamic = 'force-dynamic'

// Next 14 : objet simple ; les versions suivantes passent une Promise.
type Contexte = { params: { id: string } | Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Contexte) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse
  try {
    const { id } = await params
    return NextResponse.json({ data: await lireRapport(garde.contexte, id) })
  } catch (error) {
    return reponseErreur(error, 'GET /api/medic-assist/rapports-programmes/[id]')
  }
}

export async function PATCH(request: NextRequest, { params }: Contexte) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse
  try {
    const { id } = await params
    const corps = ModifierRapportProgrammeCorpsSchema.parse(await request.json().catch(() => null))
    return NextResponse.json({ data: await modifierRapport(garde.contexte, id, corps) })
  } catch (error) {
    return reponseErreur(error, 'PATCH /api/medic-assist/rapports-programmes/[id]')
  }
}

export async function DELETE(_request: NextRequest, { params }: Contexte) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse
  try {
    const { id } = await params
    await supprimerRapport(garde.contexte, id)
    return NextResponse.json({ data: { ok: true } })
  } catch (error) {
    return reponseErreur(error, 'DELETE /api/medic-assist/rapports-programmes/[id]')
  }
}
