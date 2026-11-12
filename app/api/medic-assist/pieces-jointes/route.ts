/**
 * POST /api/medic-assist/pieces-jointes
 * Envoi d'une piece jointe (multipart : champ `fichier`, repli temporaire `file`, champ facultatif
 * `conversationId`).
 *
 * Reponses : 201 PieceJointeDto, 400 (fichier absent, extension,
 * nom, signature, .xls), 413 (trop gros), 422 (illisible, avec le code). Le contenu du
 * fichier n'est jamais journalise.
 */

import { NextRequest, NextResponse } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { CHAMPS_TELEVERSEMENT, LIMITES } from '@/lib/medic-assist/contrats'
import { ErreurPieceJointe } from '@/lib/medic-assist/pieces-jointes/erreurs'
import { enregistrerPieceJointe } from '@/lib/medic-assist/pieces-jointes/service'

/** Marge pour les en-tetes multipart au-dessus de la taille maximale du fichier. */
const MARGE_MULTIPART_OCTETS = 1024 * 1024

const FORMAT_ID = /^[A-Za-z0-9_-]{1,64}$/

function reponseErreur(erreur: ErreurPieceJointe) {
  return NextResponse.json(
    { error: erreur.code, message: erreur.message },
    { status: erreur.statut }
  )
}

export async function POST(request: NextRequest) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  try {
    // Refus d'emblee d'un corps manifestement trop gros, avant de le lire.
    const annonce = Number(request.headers.get('content-length'))
    if (
      Number.isFinite(annonce) &&
      annonce > LIMITES.tailleMaxPieceJointeOctets + MARGE_MULTIPART_OCTETS
    ) {
      return reponseErreur(new ErreurPieceJointe('fichierTropGros'))
    }

    let formulaire: FormData
    try {
      formulaire = await request.formData()
    } catch {
      return reponseErreur(new ErreurPieceJointe('fichierAbsent'))
    }

    const fichier = formulaire.get(CHAMPS_TELEVERSEMENT.fichier)
    if (!fichier || typeof fichier === 'string') {
      return reponseErreur(new ErreurPieceJointe('fichierAbsent'))
    }
    if (fichier.size > LIMITES.tailleMaxPieceJointeOctets) {
      return reponseErreur(new ErreurPieceJointe('fichierTropGros'))
    }

    const brut = formulaire.get(CHAMPS_TELEVERSEMENT.conversationId)
    const conversationId = typeof brut === 'string' && brut.trim() !== '' ? brut.trim() : null
    if (conversationId && !FORMAT_ID.test(conversationId)) {
      return reponseErreur(new ErreurPieceJointe('conversationIntrouvable'))
    }

    const octets = Buffer.from(await fichier.arrayBuffer())
    const piece = await enregistrerPieceJointe(
      garde.contexte,
      { nom: fichier.name, octets },
      { conversationId }
    )
    return NextResponse.json(piece, { status: 201 })
  } catch (erreur) {
    if (erreur instanceof ErreurPieceJointe) return reponseErreur(erreur)
    // Seul le type de l'erreur est journalise : jamais le fichier ni son nom.
    console.error('Medic Assist : envoi de piece jointe impossible', (erreur as Error)?.name)
    return NextResponse.json(
      { error: 'erreurServeur', message: 'Unable to save the attachment.' },
      { status: 500 }
    )
  }
}
