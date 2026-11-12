/**
 * GET /api/medic-assist/admin/usages?du=&au=&groupement=jour|mois&utilisateurId=&fournisseur=
 *     &modele=&mode=&format=json|xlsx
 * Usages et couts de l'assistant (UsagesQuerySchema du lot 0 + `format`). Reserve aux
 * administrateurs. Le cout est celui ENREGISTRE sur chaque appel (USD) ; la reponse ajoute le
 * taux EUR/USD. Fenetre maximale : USAGES_FENETRE_MAX_JOURS (400 periodeInvalide).
 */

import { NextRequest, NextResponse } from 'next/server'

import {
  lireNomsUtilisateurs,
  lireTauxEurParUsdSaisi,
  lireUsagesGroupes,
} from '@/lib/medic-assist/admin/depot-prisma'
import { genererClasseurUsages, nomFichierUsages } from '@/lib/medic-assist/admin/export-usages'
import {
  UsagesQuerySchema,
  exigerAdminMedicAssist,
} from '@/lib/medic-assist/admin/imports-lot0-lot1'
import { ENTETES_SANS_CACHE, erreurApi, erreurValidation } from '@/lib/medic-assist/admin/reponses'
import {
  FORMATS_USAGES,
  TAUX_EUR_PAR_USD_DEFAUT,
  type FormatUsages,
  type UsagesReponse,
} from '@/lib/medic-assist/admin/types'
import { agregerUsages, resoudreFenetre } from '@/lib/medic-assist/admin/usages'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function GET(request: NextRequest) {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return garde.reponse

  const brut: Record<string, string> = {}
  request.nextUrl.searchParams.forEach((valeur, cle) => {
    brut[cle] = valeur
  })
  // `format` n'appartient pas a UsagesQuerySchema : lu a part.
  const { format: formatBrut = 'json', ...criteres } = brut
  if (!(FORMATS_USAGES as readonly string[]).includes(formatBrut)) {
    return erreurApi(400, 'validationInvalide', 'Format expected: json or xlsx.')
  }
  const format = formatBrut as FormatUsages

  const analyse = UsagesQuerySchema.safeParse(criteres)
  if (!analyse.success) return erreurValidation(analyse.error)
  const requete = analyse.data
  const fenetre = resoudreFenetre(requete.du, requete.au)
  if (!fenetre.ok) return erreurApi(400, fenetre.code, fenetre.message)
  const groupement = requete.groupement ?? 'jour'

  try {
    const [lignes, tauxSaisi] = await Promise.all([
      lireUsagesGroupes({
        depuis: fenetre.fenetre.depuis,
        avant: fenetre.fenetre.avant,
        utilisateurId: requete.utilisateurId,
        fournisseur: requete.fournisseur,
        modele: requete.modele,
        mode: requete.mode,
      }),
      lireTauxEurParUsdSaisi(),
    ])
    const noms = await lireNomsUtilisateurs(lignes.map(l => l.userId))
    const corps: UsagesReponse = {
      ...agregerUsages({
        lignes,
        debut: fenetre.fenetre.debut,
        fin: fenetre.fenetre.fin,
        groupement,
        nomsUtilisateurs: noms,
      }),
      tauxEurParUsd: tauxSaisi ?? TAUX_EUR_PAR_USD_DEFAUT,
      tauxSource: tauxSaisi === null ? 'defaut' : 'config',
    }

    if (format === 'xlsx') {
      const classeur = await genererClasseurUsages(corps, garde.contexte.locale, groupement)
      return new NextResponse(new Uint8Array(classeur), {
        headers: {
          'Content-Type': TYPE_XLSX,
          'Content-Disposition': `attachment; filename="${nomFichierUsages(corps)}"`,
          ...ENTETES_SANS_CACHE,
        },
      })
    }
    return NextResponse.json(corps, { headers: ENTETES_SANS_CACHE })
  } catch {
    return erreurApi(500, 'erreurServeur', 'Could not read the usage figures.')
  }
}
