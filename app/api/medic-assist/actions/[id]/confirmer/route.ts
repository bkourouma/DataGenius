/**
 * POST /api/medic-assist/actions/[id]/confirmer : clic « Confirmer » de la carte.
 * Corps facultatif { parametres?: {...} } : champs modifies sur la carte
 * (revalides cote serveur). Renvoie 200 meme si l'execution a echoue : la carte
 * affiche le statut 'echec'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { executerAction } from '@/lib/medic-assist/suivi/actions'
import { ErreurSuivi, reponseErreur } from '@/lib/medic-assist/suivi/erreurs'

export const dynamic = 'force-dynamic'

type Contexte = { params: { id: string } | Promise<{ id: string }> }

const CorpsSchema = z.object({ parametres: z.record(z.string(), z.unknown()).optional() })

async function lireCorps(request: NextRequest): Promise<z.infer<typeof CorpsSchema>> {
  const brut = await request.text()
  if (!brut.trim()) return {}
  let json: unknown
  try {
    json = JSON.parse(brut)
  } catch {
    throw new ErreurSuivi('invalide', 'JSON illisible')
  }
  return CorpsSchema.parse(json ?? {})
}

export async function POST(request: NextRequest, contexte: Contexte) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const { id } = await contexte.params
    const corps = await lireCorps(request)
    const action = await executerAction(garde.contexte, id, corps.parametres)
    return NextResponse.json({ data: action })
  } catch (error) {
    return reponseErreur(error, 'POST /api/medic-assist/actions/[id]/confirmer')
  }
}
