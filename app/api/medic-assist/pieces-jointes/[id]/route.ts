/**
 * GET    /api/medic-assist/pieces-jointes/[id] : metadonnees et resume (proprietaire seulement)
 * DELETE /api/medic-assist/pieces-jointes/[id] : supprime la ligne et le fichier
 *
 * Une piece qui n'est pas au demandeur repond 404, comme une piece inexistante.
 */

import { NextRequest, NextResponse } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { ErreurPieceJointe } from '@/lib/medic-assist/pieces-jointes/erreurs'
import { lireMetadonnees, supprimerPieceJointe } from '@/lib/medic-assist/pieces-jointes/service'

interface RouteParams {
  params: { id: string }
}

function erreurServeur(erreur: unknown) {
  console.error('Medic Assist : piece jointe', (erreur as Error)?.name)
  return NextResponse.json(
    { error: 'erreurServeur', message: 'Operation failed on the attachment.' },
    { status: 500 }
  )
}

function introuvable() {
  const erreur = new ErreurPieceJointe('pieceJointeIntrouvable')
  return NextResponse.json({ error: erreur.code, message: erreur.message }, { status: 404 })
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  try {
    const piece = await lireMetadonnees(garde.contexte, params.id)
    return piece ? NextResponse.json(piece) : introuvable()
  } catch (erreur) {
    return erreurServeur(erreur)
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  try {
    const supprimee = await supprimerPieceJointe(garde.contexte, params.id)
    return supprimee ? new NextResponse(null, { status: 204 }) : introuvable()
  } catch (erreur) {
    return erreurServeur(erreur)
  }
}
