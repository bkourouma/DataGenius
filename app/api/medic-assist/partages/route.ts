/**
 * POST /api/medic-assist/partages { objet, objetId, destinataires, message? } (forme du
 *   contrat) OU { cible: {type, id}, destinataires, message? } (forme de l'ecran) :
 *   partage une conversation ou un artefact dont on est proprietaire. Si les deux
 *   formes sont donnees, objet/objetId l'emporte.
 * GET  /api/medic-assist/partages?sens=recus|envoyes&page=&taille= : mes partages.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { IdentifiantSchema, LIMITES, OBJETS_PARTAGE } from '@/lib/medic-assist/contrats'
import { ErreurSuivi, lirePagination, reponseErreur } from '@/lib/medic-assist/suivi/erreurs'
import {
  listerPartagesEnvoyes,
  listerPartagesRecus,
  partager,
} from '@/lib/medic-assist/suivi/partages'

export const dynamic = 'force-dynamic'

const schemaCorps = z.object({
  objet: z.enum(OBJETS_PARTAGE).optional(),
  objetId: IdentifiantSchema.optional(),
  cible: z
    .object({
      type: z.enum(OBJETS_PARTAGE),
      id: IdentifiantSchema,
    })
    .optional(),
  destinataires: z.array(IdentifiantSchema).min(1).max(LIMITES.destinatairesMax),
  message: z.string().max(LIMITES.longueurMaxMessageAction).optional(),
})

/** Ramene les deux formes de corps a la demande du service ; objet/objetId prioritaire. */
function demandeDepuisCorps(corps: z.infer<typeof schemaCorps>) {
  let cible = corps.cible
  if (corps.objet || corps.objetId) {
    if (!corps.objet || !corps.objetId) {
      throw new ErreurSuivi('invalide', 'objet et objetId vont ensemble')
    }
    cible = { type: corps.objet, id: corps.objetId }
  }
  if (!cible) throw new ErreurSuivi('invalide', 'objet/objetId ou cible attendu')
  return { cible, destinataires: corps.destinataires, message: corps.message }
}

export async function POST(request: NextRequest) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const corps = schemaCorps.parse(await request.json().catch(() => null))
    const resultat = await partager(garde.contexte, demandeDepuisCorps(corps))
    return NextResponse.json({ data: resultat }, { status: 201 })
  } catch (error) {
    return reponseErreur(error, 'POST /api/medic-assist/partages')
  }
}

export async function GET(request: NextRequest) {
  try {
    const garde = await exigerMedicAssist()
    if (!garde.ok) return garde.reponse
    const params = request.nextUrl.searchParams
    const pagination = lirePagination(params)
    const { lignes, total } =
      params.get('sens') === 'envoyes'
        ? await listerPartagesEnvoyes(garde.contexte, pagination)
        : await listerPartagesRecus(garde.contexte, pagination)
    return NextResponse.json({ data: lignes, total })
  } catch (error) {
    return reponseErreur(error, 'GET /api/medic-assist/partages')
  }
}
