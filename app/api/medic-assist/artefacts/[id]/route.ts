import { NextRequest } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import {
  construireReponseArtefact,
  reponseErreurArtefact,
  reponseJsonArtefact,
} from '@/lib/medic-assist/artefacts/service-reponse'
import { modifierArtefactParUtilisateur } from '@/lib/medic-assist/artefacts/stockage-impl'
import {
  ArtefactQuerySchema,
  IdentifiantSchema,
  ModifierArtefactCorpsSchema,
} from '@/lib/medic-assist/contrats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Corps de PATCH : 1 Mo au plus. */
const CORPS_MAX_OCTETS = 1_000_000

interface RouteParams {
  params: { id: string }
}

const introuvable = () =>
  reponseJsonArtefact({ error: 'NotFound', message: 'Artefact introuvable.' }, 404)
const requeteInvalide = () =>
  reponseJsonArtefact({ error: 'BadRequest', message: 'Requête invalide.' }, 400)
const tropVolumineux = () =>
  reponseJsonArtefact({ error: 'PayloadTooLarge', message: 'Requête trop volumineuse.' }, 413)

/**
 * GET /api/medic-assist/artefacts/[id]?version=n
 *
 * Lit un artefact : `ArtefactReponse` (DTO du contrat, lignes des jeux dans `donnees`,
 * artefacts cités par un document dans `artefactsLies`). `version` : version à lire, la
 * dernière par défaut.
 *
 * - Accès : `exigerMedicAssist()` (401, 403), puis propriétaire, partage (artefact ou
 *   conversation) ou épingle, vérifié dans la requête de lecture elle-même.
 * - 400 : `version` invalide. 404 : artefact (ou version) absent ou non accessible, même
 *   réponse dans les deux cas.
 * - Le SQL de la provenance n'est renvoyé qu'aux administrateurs de Medic Assist.
 * - `Cache-Control: private, no-store`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  const id = IdentifiantSchema.safeParse(params.id)
  if (!id.success) return introuvable()
  const brut = new URL(request.url).searchParams.get('version')
  const requete = ArtefactQuerySchema.safeParse({ version: brut ?? undefined })
  if (!requete.success) return requeteInvalide()

  try {
    const reponse = await construireReponseArtefact(garde.contexte, id.data, {
      version: requete.data.version,
    })
    return reponseJsonArtefact(reponse)
  } catch (erreur) {
    return reponseErreurArtefact(erreur)
  }
}

/**
 * PATCH /api/medic-assist/artefacts/[id]
 *
 * Édite un artefact depuis le panneau : corps `{ spec, versionAttendue? }` (nouvelle version)
 * ou `{ restaurerVersion }` (nouvelle version qui recopie une version antérieure). Réponse :
 * `ArtefactReponse` de la nouvelle version, auteur « utilisateur ».
 *
 * - Accès : `exigerMedicAssist()` (401, 403).
 * - 400 : corps absent, mal formé ou spécification invalide ; jeu non accessible.
 * - 403 : le lecteur voit l'artefact (partage, épingle) mais n'en est pas propriétaire.
 * - 404 : artefact ou version absent ou non accessible. 413 : corps de plus de 1 Mo.
 * - 409 : `versionAttendue` plus ancienne que la dernière version, ou conflit d'écriture.
 * - Aucun détail interne dans les messages. `Cache-Control: private, no-store`.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  const id = IdentifiantSchema.safeParse(params.id)
  if (!id.success) return introuvable()

  const annonce = Number(request.headers.get('content-length') ?? 0)
  if (annonce > CORPS_MAX_OCTETS) return tropVolumineux()

  let brut: string
  try {
    brut = await request.text()
  } catch {
    return requeteInvalide()
  }
  if (Buffer.byteLength(brut, 'utf8') > CORPS_MAX_OCTETS) return tropVolumineux()

  let json: unknown
  try {
    json = JSON.parse(brut)
  } catch {
    return requeteInvalide()
  }
  const corps = ModifierArtefactCorpsSchema.safeParse(json)
  if (!corps.success) return requeteInvalide()

  try {
    const cree = await modifierArtefactParUtilisateur(garde.contexte, id.data, corps.data)
    const reponse = await construireReponseArtefact(garde.contexte, cree.artefactId, {
      version: cree.version,
    })
    return reponseJsonArtefact(reponse)
  } catch (erreur) {
    return reponseErreurArtefact(erreur)
  }
}
