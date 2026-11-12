/**
 * DELETE /api/medic-assist/analyses/[id] : retire l'artefact `id` de Mes analyses
 * (l'artefact lui-meme n'est pas supprime).
 */

import { NextRequest, NextResponse } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { retirerAnalyse } from '@/lib/medic-assist/suivi/analyses'
import { reponseErreur } from '@/lib/medic-assist/suivi/erreurs'

export const dynamic = 'force-dynamic'

type Contexte = { params: { id: string } | Promise<{ id: string }> }

export async function DELETE(_request: NextRequest, contexte: Contexte) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const { id } = await contexte.params
    await retirerAnalyse(garde.contexte, id)
    return NextResponse.json({ data: { ok: true } })
  } catch (error) {
    return reponseErreur(error, 'DELETE /api/medic-assist/analyses/[id]')
  }
}
