import { NextRequest } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import {
  reponseErreurArtefact,
  reponseJsonArtefact,
} from '@/lib/medic-assist/artefacts/service-reponse'
import { listerArtefactsConversation } from '@/lib/medic-assist/artefacts/stockage-impl'
import { IdentifiantSchema } from '@/lib/medic-assist/contrats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/medic-assist/artefacts?conversationId=…
 *
 * Artefacts d'une conversation (onglets du panneau) : `{ artefacts: ArtefactResumeReponse[] }`,
 * dernière version de chaque racine, dans l'ordre de création.
 *
 * - Accès : `exigerMedicAssist()` (401 sans session, 403 sans droit). Le lecteur voit ses
 *   propres artefacts de la conversation et, si la conversation lui est partagée, ceux de son
 *   propriétaire (règle posée dans le `where`).
 * - 400 : `conversationId` absent ou mal formé.
 * - Conversation inconnue ou d'un autre utilisateur : liste vide, jamais d'erreur révélatrice.
 * - `Cache-Control: private, no-store`.
 */
export async function GET(request: NextRequest) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  const lecture = IdentifiantSchema.safeParse(
    new URL(request.url).searchParams.get('conversationId') ?? undefined
  )
  if (!lecture.success) {
    return reponseJsonArtefact({ error: 'BadRequest', message: 'Requête invalide.' }, 400)
  }

  try {
    const artefacts = await listerArtefactsConversation(garde.contexte, lecture.data)
    return reponseJsonArtefact({ artefacts })
  } catch (erreur) {
    return reponseErreurArtefact(erreur)
  }
}
