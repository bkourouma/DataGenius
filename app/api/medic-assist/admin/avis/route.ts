/**
 * GET /api/medic-assist/admin/avis?valeur=positif|negatif&du=&au=&curseur=&taille=
 * Avis donnes sur les reponses de l'assistant (pouce haut ou bas), en LECTURE SEULE.
 * Reserve aux administrateurs. Reponse ListeAvisAdminDto { avis, totaux, suivant } ; les
 * totaux couvrent la periode, tous avis confondus. Sans `valeur`, les deux sortes sont listees.
 */

import { NextRequest, NextResponse } from 'next/server'

import { assemblerAvis } from '@/lib/medic-assist/admin/avis'
import { compterAvis, lireAvisBruts } from '@/lib/medic-assist/admin/depot-prisma'
import {
  AvisAdminQuerySchema,
  LIMITES,
  exigerAdminMedicAssist,
} from '@/lib/medic-assist/admin/dependances'
import { ENTETES_SANS_CACHE, erreurApi, erreurValidation } from '@/lib/medic-assist/admin/reponses'
import { ajouterJours, instantDebutJourParis } from '@/lib/medic-assist/admin/usages'
import type { ListeAvisAdminDto } from '@/lib/medic-assist/contrats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return garde.reponse

  const brut: Record<string, string> = {}
  request.nextUrl.searchParams.forEach((valeur, cle) => {
    brut[cle] = valeur
  })
  const analyse = AvisAdminQuerySchema.safeParse(brut)
  if (!analyse.success) return erreurValidation(analyse.error)
  const requete = analyse.data
  const taille = requete.taille ?? LIMITES.taillePageListeDefaut
  const depuis = requete.du ? instantDebutJourParis(requete.du) : undefined
  const avant = requete.au ? instantDebutJourParis(ajouterJours(requete.au, 1)) : undefined

  try {
    const [donnees, totaux] = await Promise.all([
      lireAvisBruts({ valeur: requete.valeur, depuis, avant, curseur: requete.curseur, taille }),
      compterAvis({ depuis, avant }),
    ])
    const { avis, suivant } = assemblerAvis(donnees, taille)
    const corps: ListeAvisAdminDto = { avis, totaux, suivant }
    return NextResponse.json(corps, { headers: ENTETES_SANS_CACHE })
  } catch {
    return erreurApi(500, 'erreurServeur', 'Could not read the feedback.')
  }
}
