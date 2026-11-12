/**
 * Garde unique de Medic Assist (architecture §3). Chaque route
 * /api/medic-assist/* appelle exigerMedicAssist() ou exigerAdminMedicAssist() :
 * le middleware ne filtre pas ces API. Le perimetre vient de la session, jamais
 * du modele.
 */

import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'

import { defaultLocale } from '@/i18n/config'
import { langueChoisie } from '@/i18n/langue-choisie'
import { getAccessScope, reponseSessionPerimee, type AccessScope } from '@/lib/auth/access-scope'
import { exigerSession, reponseInterdite } from '@/lib/auth/garde-api'
import type { ContexteExecution } from '@/lib/medic-assist/contrats/contexte'
import {
  peutAdministrerMedicAssist,
  peutUtiliserMedicAssist,
} from '@/lib/medic-assist/contrats/droits'
import { lireJourLimite } from '@/lib/services/sorties-locales-delai'

export { peutAdministrerMedicAssist, peutUtiliserMedicAssist }

export type ResultatAccesMedicAssist =
  | { ok: true; session: Session; scope: AccessScope; contexte: ContexteExecution }
  | { ok: false; reponse: NextResponse }

async function acces(
  autorise: (roleName: string, scope: AccessScope, habilitations: string[] | null) => boolean,
  message: string
): Promise<ResultatAccesMedicAssist> {
  const garde = await exigerSession()
  if (!garde.ok) return garde
  const { session } = garde

  const scope = await getAccessScope(session.user.id)
  if (!scope) return { ok: false, reponse: reponseSessionPerimee({ error: 'Unauthorized' }) }

  // Role relu en base par getAccessScope : la session peut etre en retard sur un changement de role.
  const roleName = scope.roleName
  const habilitations = session.user.habilitations ?? null
  if (!autorise(roleName, scope, habilitations)) {
    return { ok: false, reponse: reponseInterdite(message) }
  }

  const contexte: ContexteExecution = {
    userId: session.user.id,
    roleName,
    scope,
    habilitations,
    locale: langueChoisie() ?? defaultLocale,
    maintenant: new Date(),
    jourLimite: await lireJourLimite(),
  }
  return { ok: true, session, scope, contexte }
}

/** Siege (scope.voitTout) et, pour un compte a profil, habilitation medicAssist. */
export function exigerMedicAssist(): Promise<ResultatAccesMedicAssist> {
  return acces(
    (roleName, scope, habilitations) => peutUtiliserMedicAssist(roleName, scope, habilitations),
    'Data Genius membership required'
  )
}

/** SuperAdmin ou TenantAdmin, plus « settings » pour un compte a profil. */
export function exigerAdminMedicAssist(): Promise<ResultatAccesMedicAssist> {
  return acces(
    (roleName, scope, habilitations) =>
      scope.voitTout && peutAdministrerMedicAssist(roleName, habilitations),
    'Data Genius administrator required'
  )
}

