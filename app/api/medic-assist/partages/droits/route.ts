/**
 * GET /api/medic-assist/partages/droits?artefactId=X -> { data: { proprietaire: boolean } }.
 * Dit a l'ecran si l'utilisateur peut partager, envoyer ou programmer cet artefact
 * (proprietaire) ou seulement le voir et l'epingler (destinataire en lecture seule).
 * 404 si l'artefact n'est pas visible par l'utilisateur.
 */

import { NextRequest, NextResponse } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { IdentifiantSchema } from '@/lib/medic-assist/contrats'
import { reponseErreur } from '@/lib/medic-assist/suivi/erreurs'
import { droitsSurArtefact } from '@/lib/medic-assist/suivi/partages'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const artefactId = IdentifiantSchema.parse(request.nextUrl.searchParams.get('artefactId'))
    return NextResponse.json({ data: await droitsSurArtefact(garde.contexte, artefactId) })
  } catch (error) {
    return reponseErreur(error, 'GET /api/medic-assist/partages/droits')
  }
}
