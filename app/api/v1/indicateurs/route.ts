import { z } from 'zod'
import { jsonPrive, lireCorps, limiterIntegration } from '@/lib/integration/http'
import { exigerLectureApi } from '@/lib/integration/cles-api'
import { calculerSemantique } from '@/lib/medic-assist/donnees/moteur/calculer'
import { ErreurDonnees } from '@/lib/medic-assist/donnees/types'

export const dynamic = 'force-dynamic'

const cle = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)
const requete = z.strictObject({
  jeu: cle, mesures: z.array(cle).min(1).max(8), dimensions: z.array(cle).max(6).optional(),
  filtres: z.record(cle, z.string().min(1).max(300)).refine(f => Object.keys(f).length <= 12).optional(),
  limite: z.number().int().min(1).max(500).optional(),
})

export async function POST(request: Request) {
  const acces = await exigerLectureApi(request)
  if (!acces.ok) return acces.reponse
  const limite = limiterIntegration(acces.contexte.userId)
  if (limite) return limite
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return jsonPrive({ erreur: 'type_contenu_invalide' }, 415)
  }
  let corps: unknown
  try { corps = JSON.parse(await lireCorps(request)) } catch { return jsonPrive({ erreur: 'requete_invalide' }, 400) }
  const valide = requete.safeParse(corps)
  if (!valide.success) return jsonPrive({ erreur: 'requete_invalide' }, 400)
  try {
    const { colonnes, lignes, totaux, tronque, provenance } = await calculerSemantique(
      valide.data, acces.contexte, { limiteLignes: valide.data.limite ?? 100 },
    )
    const { sql: _sql, ...contexte } = provenance
    return jsonPrive({ colonnes, lignes, totaux, tronque, provenance: contexte })
  } catch (erreur) {
    if (!(erreur instanceof ErreurDonnees)) throw erreur
    if (erreur.code === 'jeu_inconnu' || erreur.code === 'acces_refuse') return jsonPrive({ erreur: 'jeu_introuvable' }, 404)
    const execution = erreur.code === 'sql_erreur' || erreur.code === 'sql_delai' || erreur.code === 'role_lecture_absent'
    return jsonPrive({ erreur: erreur.code }, execution ? 503 : 400)
  }
}
