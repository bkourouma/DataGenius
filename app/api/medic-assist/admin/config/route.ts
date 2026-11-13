/**
 * GET|PUT /api/medic-assist/admin/config : fournisseur, modeles, dictee serveur et taux
 * EUR/USD. Reserve aux administrateurs (garde en premiere ligne). Aucune cle d'API n'est lue,
 * renvoyee ni journalisee : seule la PRESENCE des variables compte.
 * Erreurs : { error: <code de codes-erreur.ts>, message }.
 */

import { NextRequest, NextResponse } from 'next/server'

import {
  codeErreurConfig,
  construireConfigAdminReponse,
  separerTaux,
} from '@/lib/medic-assist/admin/config-admin'
import {
  ecrireTauxEurParUsd,
  lireDerniereMiseAJour,
  lireTauxEurParUsdSaisi,
} from '@/lib/medic-assist/admin/depot-prisma'
import {
  ecrireConfigMedicAssist,
  exigerAdminMedicAssist,
  fournisseursDisponibles,
  fournisseursTranscriptionDisponibles,
  lireConfigMedicAssist,
} from '@/lib/medic-assist/admin/dependances'
import {
  ENTETES_SANS_CACHE,
  erreurApi,
  erreurValidation,
  lireCorpsJson,
} from '@/lib/medic-assist/admin/reponses'
import { ConfigAdminCorpsLot6Schema } from '@/lib/medic-assist/admin/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function reponseConfig() {
  const [config, taux, maj] = await Promise.all([
    lireConfigMedicAssist(),
    lireTauxEurParUsdSaisi(),
    lireDerniereMiseAJour(),
  ])
  return NextResponse.json(construireConfigAdminReponse(config, taux, maj), {
    headers: ENTETES_SANS_CACHE,
  })
}

export async function GET() {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return garde.reponse
  try {
    return await reponseConfig()
  } catch {
    return erreurApi(500, 'erreurServeur', 'Could not read the configuration.')
  }
}

export async function PUT(request: NextRequest) {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return garde.reponse

  const brut = await lireCorpsJson(request)
  if (brut === null) return erreurApi(400, 'validationInvalide', 'JSON body expected.')
  const analyse = ConfigAdminCorpsLot6Schema.safeParse(brut)
  if (!analyse.success) return erreurValidation(analyse.error)
  const { config, tauxEurParUsd } = separerTaux(analyse.data)

  const indisponible = () =>
    erreurApi(400, 'fournisseurIndisponible', 'This provider has no API key on the server.')
  if (!fournisseursDisponibles().includes(config.fournisseur)) return indisponible()
  if (
    config.transcription &&
    !fournisseursTranscriptionDisponibles().includes(config.transcription.fournisseur)
  ) {
    return indisponible()
  }

  try {
    await ecrireConfigMedicAssist(garde.contexte, config)
    if (tauxEurParUsd !== undefined) {
      await ecrireTauxEurParUsd(tauxEurParUsd, garde.contexte.userId)
    }
    return await reponseConfig()
  } catch (erreur) {
    const code = codeErreurConfig(erreur)
    if (code === 'fournisseurIndisponible') return indisponible()
    if (code === 'validationInvalide') return erreurApi(400, code, 'Invalid configuration.')
    return erreurApi(500, 'erreurServeur', 'Could not save the configuration.')
  }
}
