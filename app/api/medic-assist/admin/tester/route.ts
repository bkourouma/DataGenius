/**
 * POST /api/medic-assist/admin/tester : un appel minimal au modele d'un mode (ou d'un couple
 * fournisseur/modele pas encore enregistre), pour verifier la cle et le nom du modele avant
 * de l'enregistrer. Aucune ecriture d'usage. Reserve aux administrateurs.
 * Reponse ResultatTestAdmin : l'echec est un code stable (`erreurCode`), jamais le texte du
 * fournisseur ; la cle n'apparait nulle part.
 */

import { NextRequest, NextResponse } from 'next/server'

import { schemaCorpsTest } from '@/lib/medic-assist/admin/config-admin'
import {
  exigerAdminMedicAssist,
  fournisseursDisponibles,
  lireConfigMedicAssist,
  modelesParDefaut,
} from '@/lib/medic-assist/admin/imports-lot0-lot1'
import {
  ENTETES_SANS_CACHE,
  erreurApi,
  erreurValidation,
  lireCorpsJson,
} from '@/lib/medic-assist/admin/reponses'
import { testerModele } from '@/lib/medic-assist/admin/tester'
import type { ResultatTestAdmin } from '@/lib/medic-assist/admin/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return garde.reponse

  const brut = await lireCorpsJson(request)
  if (brut === null) return erreurApi(400, 'validationInvalide', 'JSON body expected.')
  const analyse = schemaCorpsTest.safeParse(brut)
  if (!analyse.success) return erreurValidation(analyse.error)
  const corps = analyse.data

  let config
  try {
    config = await lireConfigMedicAssist()
  } catch {
    return erreurApi(500, 'erreurServeur', 'Could not read the configuration.')
  }

  const fournisseur = corps.fournisseur ?? config.fournisseur
  const modele =
    corps.modele ??
    (fournisseur === config.fournisseur
      ? config.modeles[corps.mode]
      : modelesParDefaut(fournisseur)[corps.mode])
  if (!modele) return erreurApi(400, 'validationInvalide', 'No model is defined for this mode.')

  // Pas de cle sur le serveur : resultat « indisponible », sans appel au fournisseur.
  if (!fournisseursDisponibles().includes(fournisseur)) {
    const indisponible: ResultatTestAdmin = {
      ok: false,
      latenceMs: 0,
      fournisseur,
      modele,
      erreurCode: 'indisponible',
    }
    return NextResponse.json(indisponible, { headers: ENTETES_SANS_CACHE })
  }

  const resultat = await testerModele(fournisseur, modele)
  const reponse: ResultatTestAdmin = {
    ok: resultat.ok,
    latenceMs: resultat.latenceMs,
    fournisseur,
    modele,
    ...(resultat.erreurCode ? { erreurCode: resultat.erreurCode } : {}),
  }
  return NextResponse.json(reponse, { headers: ENTETES_SANS_CACHE })
}
