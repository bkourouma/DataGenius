/**
 * GET   /api/medic-assist/taches?etat=a_faire|en_retard|terminee : mes taches.
 * PATCH /api/medic-assist/taches { id, terminee } : marque terminee ou rouvre
 *   (seule la personne assignee peut le faire).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { reponseErreur } from '@/lib/medic-assist/suivi/erreurs'
import { changerEtatTache, listerTaches } from '@/lib/medic-assist/suivi/taches'

export const dynamic = 'force-dynamic'

const schemaEtat = z.enum(['a_faire', 'en_retard', 'terminee'])
const schemaCorps = z.object({ id: z.string().min(1).max(200), terminee: z.boolean() })

export async function GET(request: NextRequest) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const brut = request.nextUrl.searchParams.get('etat')
    const etat = brut ? schemaEtat.parse(brut) : undefined
    const taches = await listerTaches(garde.contexte, etat ? { etat } : {})
    return NextResponse.json({ data: taches })
  } catch (error) {
    return reponseErreur(error, 'GET /api/medic-assist/taches')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const corps = schemaCorps.parse(await request.json().catch(() => null))
    const tache = await changerEtatTache(garde.contexte, corps)
    return NextResponse.json({ data: tache })
  } catch (error) {
    return reponseErreur(error, 'PATCH /api/medic-assist/taches')
  }
}
