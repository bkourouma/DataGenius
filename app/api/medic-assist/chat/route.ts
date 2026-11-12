/**
 * Chat de Medic Assist (lot 1).
 *
 * POST /api/medic-assist/chat
 * Corps : CorpsRequeteChat (dernier message seulement ; l'historique est relu en base).
 * Réponse : flux de messages UI du SDK v7 (SSE). Erreurs : 401/403 garde, 413 corps trop gros,
 * 400 validation, 404 conversation, message ou pièce jointe introuvable, 409 régénération
 * impossible, 503 fournisseur non configuré, 500.
 *
 * Route mince : la logique est dans lib/medic-assist/agent/executer.ts.
 */

import { NextRequest, NextResponse } from 'next/server'

import { LIMITES } from '@/lib/medic-assist/contrats/constantes'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { executerChat } from '@/lib/medic-assist/agent/executer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** Délai du proxy IIS ARR (LIMITES.dureeMaxFluxSecondes) : valeur littérale exigée par Next. */
export const maxDuration = 300

function tropGros() {
  return NextResponse.json(
    { error: 'payload_too_large', message: 'Request body too large' },
    { status: 413 }
  )
}

export async function POST(request: NextRequest) {
  // 1. Garde : aucune lecture du corps ni accès base avant elle.
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  // 2. Taille du corps (en-tête annoncé, puis taille réelle).
  const annoncee = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(annoncee) && annoncee > LIMITES.tailleMaxRequeteChatOctets) return tropGros()

  let texte: string
  try {
    texte = await request.text()
  } catch {
    return NextResponse.json({ error: 'validation', message: 'Unreadable body' }, { status: 400 })
  }
  if (Buffer.byteLength(texte, 'utf8') > LIMITES.tailleMaxRequeteChatOctets) return tropGros()

  // 3. JSON (la validation par schéma est faite par executerChat).
  let json: unknown
  try {
    json = JSON.parse(texte)
  } catch {
    return NextResponse.json({ error: 'validation', message: 'Invalid JSON body' }, { status: 400 })
  }

  const resultat = await executerChat({
    contexte: garde.contexte,
    corps: json,
    signal: request.signal,
  })
  if (resultat.type === 'erreur') {
    return NextResponse.json(resultat.corps, { status: resultat.statut })
  }
  return resultat.reponse
}
