/**
 * DELETE /api/medic-assist/partages/[id] : retire un partage. L'expediteur le retire,
 * le destinataire ne le voit plus ; un tiers recoit 404. Les epingles du destinataire
 * justifiees par ce partage sont supprimees avec lui.
 */

import { NextRequest, NextResponse } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { reponseErreur } from '@/lib/medic-assist/suivi/erreurs'
import { retirerPartage } from '@/lib/medic-assist/suivi/partages'

export const dynamic = 'force-dynamic'

type Parametres = { id: string }

export async function DELETE(
  _request: NextRequest,
  context: { params: Parametres | Promise<Parametres> }
) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const { id } = await context.params
    await retirerPartage(garde.contexte, id)
    return NextResponse.json({ data: { ok: true } })
  } catch (error) {
    return reponseErreur(error, 'DELETE /api/medic-assist/partages/[id]')
  }
}
