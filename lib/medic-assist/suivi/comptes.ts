/**
 * Comptes Data Genius qui peuvent recevoir ou se voir confier quelque chose de la
 * part de Medic Assist (partage, e-mail, notification, tache, rapport programme).
 *
 * HYPOTHESE H7 (prudente) : un destinataire doit avoir lui-meme acces a Medic
 * Assist. Sans cela, il recevrait des chiffres hors de son perimetre (e-mail,
 * piece jointe) ou un lien qu'il ne peut pas ouvrir (tache, notification).
 *
 * Le droit se calcule avec `peutUtiliserMedicAssist` des contrats (lot 0, §3), sur le
 * scope de CHAQUE destinataire reconstruit en base (`buildAccessScope`), jamais sur celui
 * de l'expediteur.
 */

import { defaultLocale, isLocale, type Locale } from '@/i18n/config'
import { ACCESS_SCOPE_INCLUDE, buildAccessScope } from '@/lib/auth/access-scope'
import { chargerDroitsDonnees } from '@/lib/auth/data-access'
import { STATUT_ACTIF } from '@/lib/auth/inscription'
import { prisma } from '@/lib/db/client'

import type { ContexteExecution } from '@/lib/medic-assist/contrats'
// droits.ts n'est pas re-exporte par l'index des contrats : import direct (comme acces.ts).
import {
  peutUtiliserMedicAssist,
  ROLES_SIEGE_MEDIC_ASSIST,
} from '@/lib/medic-assist/contrats/droits'
import type { CompteNotifiable, CompteResume } from './types'

const SELECTION_COMPTE = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  locale: true,
  status: true,
  ...ACCESS_SCOPE_INCLUDE,
} as const

function nomComplet(compte: { firstName: string; lastName: string }): string {
  return `${compte.firstName} ${compte.lastName}`.trim()
}

function langueDuCompte(locale: string | null): Locale {
  return isLocale(locale) ? locale : defaultLocale
}

export interface OptionsComptes {
  /** Restreint aux identifiants donnes (validation de destinataires). */
  ids?: string[]
  /** Recherche par prenom, nom ou e-mail (selecteur d'utilisateurs). */
  recherche?: string
  /** Ecarte ce compte (l'utilisateur courant). */
  exclureId?: string
  limite?: number
}

const MOTS_RECHERCHE_MAX = 5

function conditionMot(mot: string) {
  return {
    OR: [
      { firstName: { contains: mot, mode: 'insensitive' as const } },
      { lastName: { contains: mot, mode: 'insensitive' as const } },
      { email: { contains: mot, mode: 'insensitive' as const } },
    ],
  }
}

/**
 * Recherche en mots : chaque mot (5 au plus) doit correspondre au prenom, au nom
 * ou a l'e-mail, dans n'importe quel ordre (« Prenom Nom » comme « Nom Prenom »).
 * Un seul mot garde le OR simple.
 */
function filtreRecherche(recherche: string | undefined) {
  const mots = (recherche ?? '').split(/\s+/).filter(Boolean).slice(0, MOTS_RECHERCHE_MAX)
  if (mots.length === 0) return {}
  if (mots.length === 1) return conditionMot(mots[0])
  return { AND: mots.map(conditionMot) }
}

/**
 * Comptes ACTIFS, non supprimes, qui ont acces a Medic Assist, tries par nom.
 * Un identifiant inconnu, inactif ou sans acces est simplement absent du
 * resultat : l'appelant compare avec sa liste demandee pour refuser.
 */
export async function chargerComptesAvecAcces(options: OptionsComptes = {}): Promise<CompteResume[]> {
  const recherche = options.recherche?.trim()
  const utilisateurs = await prisma.user.findMany({
    where: {
      status: STATUT_ACTIF,
      deletedAt: null,
      roleName: { in: [...ROLES_SIEGE_MEDIC_ASSIST] },
      ...(options.ids ? { id: { in: options.ids } } : {}),
      ...(options.exclureId ? { NOT: { id: options.exclureId } } : {}),
      ...filtreRecherche(recherche),
    },
    select: SELECTION_COMPTE,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    // On sur-charge un peu : le filtre d'habilitations se fait apres lecture.
    take: options.limite ? options.limite * 3 : undefined,
  })

  const comptes = utilisateurs
    .filter((u) => {
      const scope = buildAccessScope(u)
      return peutUtiliserMedicAssist(scope.roleName, scope, null)
    })
    .map((u) => ({
      id: u.id,
      nom: nomComplet(u),
      email: u.email,
      locale: langueDuCompte(u.locale),
    }))
  return options.limite ? comptes.slice(0, options.limite) : comptes
}

/**
 * Valide une liste d'identifiants de destinataires : renvoie les comptes (dans
 * l'ordre demande, sans doublon) et la liste des identifiants refuses.
 */
export async function validerDestinataires(
  ids: string[],
  options: { exclureId?: string } = {}
): Promise<{ comptes: CompteResume[]; refuses: string[] }> {
  const uniques = [...new Set(ids)]
  const trouves = await chargerComptesAvecAcces({ ids: uniques })
  const parId = new Map(trouves.map((c) => [c.id, c]))
  const comptes: CompteResume[] = []
  const refuses: string[] = []
  for (const id of uniques) {
    const compte = parId.get(id)
    if (!compte || id === options.exclureId) refuses.push(id)
    else comptes.push(compte)
  }
  return { comptes, refuses }
}

/**
 * H7 (validee) pour l'action `notifier` : TOUT compte actif et non supprime peut
 * etre notifie, meme sans acces a Medic Assist. `aAcces` dit s'il peut ouvrir une
 * analyse partagee (calcule avec peutUtiliserMedicAssist sur SON scope) : sans
 * acces, il ne recoit qu'un texte, sans lien ni partage. Comptes dans l'ordre
 * demande, sans doublon ; `refuses` = inconnus, inactifs ou supprimes.
 */
export async function validerDestinatairesActifs(
  ids: string[]
): Promise<{ comptes: CompteNotifiable[]; refuses: string[] }> {
  const uniques = [...new Set(ids)]
  const utilisateurs =
    uniques.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: uniques }, status: STATUT_ACTIF, deletedAt: null },
          select: SELECTION_COMPTE,
        })
      : []
  const parId = new Map<string, CompteNotifiable>()
  for (const u of utilisateurs) {
    const scope = buildAccessScope(u)
    parId.set(u.id, {
      id: u.id,
      nom: nomComplet(u),
      email: u.email,
      locale: langueDuCompte(u.locale),
      aAcces: peutUtiliserMedicAssist(scope.roleName, scope, null),
    })
  }
  const comptes: CompteNotifiable[] = []
  const refuses: string[] = []
  for (const id of uniques) {
    const compte = parId.get(id)
    if (compte) comptes.push(compte)
    else refuses.push(id)
  }
  return { comptes, refuses }
}

/**
 * Contexte d'execution d'un compte HORS SESSION (tache planifiee : rapport
 * programme recalcule dans le perimetre de son proprietaire). Renvoie null si le
 * compte est inactif, supprime, ou n'a plus acces a Medic Assist.
 */
export async function contexteDepuisCompte(
  userId: string,
  maintenant: Date = new Date()
): Promise<ContexteExecution | null> {
  const utilisateur = await prisma.user.findFirst({
    where: { id: userId, status: STATUT_ACTIF, deletedAt: null },
    select: SELECTION_COMPTE,
  })
  if (!utilisateur) return null
  const scope = buildAccessScope(utilisateur)
  const habilitations = null
  if (!peutUtiliserMedicAssist(scope.roleName, scope, habilitations)) return null
  scope.donnees = await chargerDroitsDonnees(utilisateur.id, scope.roleName)
  return {
    userId: utilisateur.id,
    roleName: scope.roleName,
    scope,
    habilitations,
    locale: langueDuCompte(utilisateur.locale),
    maintenant,
  }
}
