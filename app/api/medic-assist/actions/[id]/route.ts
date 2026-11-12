/**
 * GET /api/medic-assist/actions/[id] : relit une action de l'utilisateur (forme
 * ActionProposee). La carte s'en sert pour hydrater ses parametres et son statut
 * reel au rechargement.
 */

import { NextRequest, NextResponse } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { lireAction } from '@/lib/medic-assist/suivi/actions'
import { reponseErreur } from '@/lib/medic-assist/suivi/erreurs'

export const dynamic = 'force-dynamic'

type Contexte = { params: { id: string } | Promise<{ id: string }> }

export async function GET(_request: NextRequest, contexte: Contexte) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const { id } = await contexte.params
    const action = await lireAction(garde.contexte, id)
    return NextResponse.json({ data: action })
  } catch (error) {
    return reponseErreur(error, 'GET /api/medic-assist/actions/[id]')
  }
}
