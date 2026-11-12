/** POST /api/medic-assist/actions/[id]/annuler : annule une action encore proposee. */

import { NextRequest, NextResponse } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { annulerAction } from '@/lib/medic-assist/suivi/actions'
import { reponseErreur } from '@/lib/medic-assist/suivi/erreurs'

export const dynamic = 'force-dynamic'

type Contexte = { params: { id: string } | Promise<{ id: string }> }

export async function POST(_request: NextRequest, contexte: Contexte) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const { id } = await contexte.params
    const action = await annulerAction(garde.contexte, id)
    return NextResponse.json({ data: action })
  } catch (error) {
    return reponseErreur(error, 'POST /api/medic-assist/actions/[id]/annuler')
  }
}
