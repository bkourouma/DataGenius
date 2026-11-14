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
import { journal } from '@/lib/journal'

import { LIMITES } from '@/lib/medic-assist/contrats/constantes'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { executerChat } from '@/lib/medic-assist/agent/executer'
import { genererReference } from '@/lib/medic-assist/agent/reference'
import { CorpsTropVolumineux, lireTexteBorne } from '@/lib/http/corps-borne'

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
    // Lecture en flux avec plafond reel : un envoi fragmente sans content-length est refuse
    // des que le plafond est depasse, sans charger le reste.
    texte = await lireTexteBorne(request, LIMITES.tailleMaxRequeteChatOctets, { fatal: false })
  } catch (erreur) {
    if (erreur instanceof CorpsTropVolumineux) return tropGros()
    return NextResponse.json({ error: 'validation', message: 'Unreadable body' }, { status: 400 })
  }

  // 3. JSON (la validation par schéma est faite par executerChat).
  let json: unknown
  try {
    json = JSON.parse(texte)
  } catch {
    return NextResponse.json({ error: 'validation', message: 'Invalid JSON body' }, { status: 400 })
  }

  let resultat: Awaited<ReturnType<typeof executerChat>>
  try {
    resultat = await executerChat({
      contexte: garde.contexte,
      corps: json,
      signal: request.signal,
    })
  } catch (erreur) {
    // Filet : executerChat gere ses erreurs ; seul le nom de l'erreur est journalise.
    const reference = genererReference()
    journal.erreur('Échec du chat', { domaine: 'chat', reference, erreur: (erreur as Error)?.name })
    return NextResponse.json(
      { error: 'internal', message: 'Internal error', details: { reference } },
      { status: 500 }
    )
  }
  if (resultat.type === 'erreur') {
    return NextResponse.json(resultat.corps, { status: resultat.statut })
  }
  return resultat.reponse
}
