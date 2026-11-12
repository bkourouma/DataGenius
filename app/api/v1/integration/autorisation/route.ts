import { z } from 'zod'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { delivrerJeton, tableauId } from '@/lib/integration/embarquement'
import { jsonPrive, lireCorps, limiterIntegration } from '@/lib/integration/http'

export const dynamic = 'force-dynamic'

const demande = z.strictObject({ tableau: tableauId, origine: z.string().max(253) })

export async function POST(request: Request) {
  const originePublique = new URL(process.env.NEXTAUTH_URL || request.url).origin
  if (request.headers.get('origin') !== originePublique) return jsonPrive({ erreur: 'origine_interdite' }, 403)
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return jsonPrive({ erreur: 'type_contenu_invalide' }, 415)
  }
  const acces = await exigerMedicAssist()
  if (!acces.ok) return acces.reponse
  const limite = limiterIntegration(acces.contexte.userId)
  if (limite) return limite
  let corps: unknown
  try { corps = JSON.parse(await lireCorps(request, 1024)) } catch { return jsonPrive({ erreur: 'requete_invalide' }, 400) }
  const valide = demande.safeParse(corps)
  if (!valide.success) return jsonPrive({ erreur: 'requete_invalide' }, 400)
  const jeton = await delivrerJeton(acces.contexte, valide.data.tableau, valide.data.origine)
  return jeton ? jsonPrive({ jeton }) : jsonPrive({ erreur: 'tableau_introuvable' }, 404)
}
