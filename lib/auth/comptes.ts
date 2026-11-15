/**
 * Gestion des comptes : invitation, reinitialisation du mot de passe, desactivation, roles.
 * Les signatures et types exportes sont consommes par les ecrans (contrat fige).
 *
 * `User.status` : 'active' (seul etat qui permet la connexion), 'invited', 'disabled'.
 * Le jeton clair n'existe qu'en memoire (lien + e-mail) : la base ne garde que son SHA-256.
 */
import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'
import { hashPassword } from '@/lib/auth/password'
import { envoyerInvitation, envoyerReinitialisation } from '@/lib/mail/comptes'
import {
  ErreurComptes, ROLES_COMPTE, type RoleCompte,
  HASH_INUTILISABLE, INVITATION_VALIDITE_MS, MESSAGE_LIEN_INVALIDE, REINITIALISATION_VALIDITE_MS,
  aMotDePasseLocal, emailValide, genererJeton, hacherJeton, jetonUtilisable, lienDefinitionMotDePasse,
  limiteDemandesAtteinte, normaliserEmail, urlPubliqueConfiguree, validerEmail, validerIdentite,
  validerMotDePasse, validerRole, verifierChangementRole, verifierDesactivation,
} from '@/lib/auth/comptes-regles'

// Definis dans comptes-regles.ts (pas d'import circulaire) et re-exportes : les ecrans importent d'ici.
export { ErreurComptes, ROLES_COMPTE }
export type { RoleCompte }

/** Etat affiche : en base `status` vaut 'active', 'invited' ou 'disabled'. */
export type StatutCompte = 'actif' | 'invite' | 'desactive'

export interface CompteListe {
  id: string
  email: string
  prenom: string
  nom: string
  roleName: string
  statut: StatutCompte
  /** Compte lie a une identite OpenID Connect (pas de mot de passe local a reinitialiser). */
  oidc: boolean
  /** Noms des groupes d'acces aux donnees. */
  groupes: string[]
  /** Fin de validite de l'invitation en cours (statut 'invite'), sinon null. */
  invitationExpireA: Date | null
}

export interface ResultatInvitation {
  /** Lien absolu a transmettre. Toujours renseigne : sans URL publique configuree, l'action echoue. */
  lien: string
  /** Fin de validite du lien. */
  expireA: Date
  /** true si le serveur SMTP a accepte le message. Sinon l'administrateur transmet `lien` lui-meme. */
  envoye: boolean
}

export type ResultatJeton =
  | { valide: true; type: 'invitation' | 'reinitialisation'; prenom: string }
  | { valide: false }

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

const STATUT_VERS_AFFICHE: Record<string, StatutCompte> = { active: 'actif', invited: 'invite', disabled: 'desactive' }
const ORDRE_STATUT: Record<StatutCompte, number> = { actif: 0, invite: 1, desactive: 2 }

/** Jamais d'e-mail ni de jeton dans les journaux : uniquement des identifiants. */
function journaliser(action: string, acteur: string | null, cible: string): void {
  journal.info('Action sur un compte', { domaine: 'comptes', action, acteur, cible })
}

async function verrouillerComptes(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('datagenius:comptes', 0))::text`
}

async function compteLieOidc(client: Pick<Tx, '$queryRaw'>, userId: string): Promise<boolean> {
  const lignes = await client.$queryRaw<{ x: number }[]>`
    SELECT 1 AS x FROM public.identites_oidc WHERE utilisateur_id = ${userId} LIMIT 1`
  return lignes.length > 0
}

function adminsActifs(tx: Tx): Promise<number> {
  return tx.user.count({ where: { roleName: 'TenantAdmin', status: 'active', deletedAt: null } })
}

async function chargerCompte(tx: Tx, compteId: string) {
  const compte = await tx.user.findFirst({ where: { id: compteId, deletedAt: null } })
  if (!compte) throw new ErreurComptes('Compte introuvable.')
  return compte
}

async function creerJeton(
  client: Pick<Tx, 'compteJeton'>, userId: string, type: 'invitation' | 'reinitialisation',
  validiteMs: number, creePar: string | null,
): Promise<{ jeton: string; expireA: Date }> {
  const jeton = genererJeton()
  const expireA = new Date(Date.now() + validiteMs)
  await client.compteJeton.create({ data: { userId, type, hash: hacherJeton(jeton), expireA, creePar } })
  return { jeton, expireA }
}

function invaliderJetons(client: Pick<Tx, 'compteJeton'>, userId: string, type?: string) {
  return client.compteJeton.updateMany({
    where: { userId, utiliseA: null, ...(type ? { type } : {}) }, data: { utiliseA: new Date() },
  })
}

function exigerUrlPublique(): void {
  if (!urlPubliqueConfiguree()) lienDefinitionMotDePasse('')
}

async function nomActeur(acteurId: string): Promise<string | undefined> {
  const acteur = await prisma.user.findUnique({ where: { id: acteurId }, select: { firstName: true, lastName: true } })
  const nom = acteur ? `${acteur.firstName} ${acteur.lastName}`.trim() : ''
  return nom || undefined
}

export async function listerComptes(): Promise<CompteListe[]> {
  const [utilisateurs, oidcLignes, groupesLignes, jetons] = await Promise.all([
    prisma.user.findMany({ where: { deletedAt: null } }),
    prisma.$queryRaw<{ utilisateur_id: string }[]>`SELECT DISTINCT utilisateur_id FROM public.identites_oidc`,
    prisma.$queryRaw<{ utilisateur_id: string; nom: string }[]>`
      SELECT m.utilisateur_id, g.nom FROM warehouse.membres_groupes AS m
      JOIN warehouse.groupes_acces AS g ON g.id = m.groupe_id ORDER BY g.nom`,
    prisma.compteJeton.findMany({
      where: { type: 'invitation', utiliseA: null, user: { status: 'invited', deletedAt: null } },
      orderBy: { creeA: 'desc' }, select: { userId: true, expireA: true },
    }),
  ])
  const oidc = new Set(oidcLignes.map(l => l.utilisateur_id))
  const groupes = new Map<string, string[]>()
  for (const l of groupesLignes) groupes.set(l.utilisateur_id, [...(groupes.get(l.utilisateur_id) ?? []), l.nom])
  const expirations = new Map<string, Date>()
  for (const j of jetons) if (!expirations.has(j.userId)) expirations.set(j.userId, j.expireA)
  return utilisateurs
    .map((u): CompteListe => {
      const statut = STATUT_VERS_AFFICHE[u.status] ?? 'desactive'
      return {
        id: u.id, email: u.email, prenom: u.firstName, nom: u.lastName, roleName: u.roleName, statut,
        oidc: oidc.has(u.id), groupes: groupes.get(u.id) ?? [],
        invitationExpireA: statut === 'invite' ? expirations.get(u.id) ?? null : null,
      }
    })
    .sort((a, b) =>
      ORDRE_STATUT[a.statut] - ORDRE_STATUT[b.statut] ||
      `${a.nom} ${a.prenom}`.trim().localeCompare(`${b.nom} ${b.prenom}`.trim(), 'fr') ||
      a.email.localeCompare(b.email))
}

export async function inviterUtilisateur(
  acteurId: string,
  entree: { email: string; prenom: string; nom: string; role: string },
): Promise<ResultatInvitation> {
  const role = validerRole(entree.role)
  const email = validerEmail(entree.email)
  const { prenom, nom } = validerIdentite(entree.prenom, entree.nom)
  // Avant toute ecriture : sans URL publique, aucun lien utilisable ne peut etre produit.
  exigerUrlPublique()
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new ErreurComptes('Un compte existe déjà avec cette adresse e-mail.')
  }
  const jeton = genererJeton()
  const expireA = new Date(Date.now() + INVITATION_VALIDITE_MS)
  let compteId: string
  try {
    const cree = await prisma.user.create({
      data: {
        email, firstName: prenom, lastName: nom, roleName: role, status: 'invited', passwordHash: HASH_INUTILISABLE,
        comptesJetons: {
          create: {
            type: 'invitation', hash: hacherJeton(jeton), creePar: acteurId,
            expireA,
          },
        },
      },
      select: { id: true },
    })
    compteId = cree.id
  } catch (erreur) {
    if ((erreur as { code?: string }).code === 'P2002') throw new ErreurComptes('Un compte existe déjà avec cette adresse e-mail.')
    throw erreur
  }
  journaliser('invitation', acteurId, compteId)
  const lien = lienDefinitionMotDePasse(jeton)
  const envoye = await envoyerInvitation({ email, prenom }, lien, await nomActeur(acteurId))
  return { lien, envoye, expireA }
}

export async function renvoyerInvitation(acteurId: string, compteId: string): Promise<ResultatInvitation> {
  exigerUrlPublique()
  const { jeton, expireA, compte } = await prisma.$transaction(async tx => {
    const compte = await chargerCompte(tx, compteId)
    if (compte.status !== 'invited') throw new ErreurComptes('Seul un compte invité peut recevoir de nouveau son invitation.')
    await invaliderJetons(tx, compte.id, 'invitation')
    return { ...await creerJeton(tx, compte.id, 'invitation', INVITATION_VALIDITE_MS, acteurId), compte }
  })
  journaliser('invitation_renvoyee', acteurId, compteId)
  const lien = lienDefinitionMotDePasse(jeton)
  const envoye = await envoyerInvitation({ email: compte.email, prenom: compte.firstName }, lien, await nomActeur(acteurId))
  return { lien, envoye, expireA }
}

export async function desactiverCompte(acteurId: string, compteId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    await verrouillerComptes(tx)
    const compte = await chargerCompte(tx, compteId)
    if (compte.status === 'disabled') throw new ErreurComptes('Ce compte est déjà désactivé.')
    verifierDesactivation(acteurId, { id: compte.id, roleName: compte.roleName, status: compte.status }, await adminsActifs(tx))
    await tx.user.update({ where: { id: compte.id }, data: { status: 'disabled' } })
    await invaliderJetons(tx, compte.id)
  })
  journaliser('desactivation', acteurId, compteId)
}

export async function reactiverCompte(acteurId: string, compteId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    await verrouillerComptes(tx)
    const compte = await chargerCompte(tx, compteId)
    if (compte.status !== 'disabled') throw new ErreurComptes("Ce compte n'est pas désactivé.")
    await tx.user.update({
      where: { id: compte.id }, data: { status: aMotDePasseLocal(compte.passwordHash) ? 'active' : 'invited' },
    })
  })
  journaliser('reactivation', acteurId, compteId)
}

export async function changerRoleCompte(acteurId: string, compteId: string, role: string): Promise<void> {
  const nouveauRole = validerRole(role)
  await prisma.$transaction(async tx => {
    await verrouillerComptes(tx)
    const compte = await chargerCompte(tx, compteId)
    verifierChangementRole(
      acteurId, { id: compte.id, roleName: compte.roleName, status: compte.status }, nouveauRole, await adminsActifs(tx),
    )
    await tx.user.update({ where: { id: compte.id }, data: { roleName: nouveauRole } })
  })
  journaliser('changement_role', acteurId, compteId)
}

/** Ne revele jamais si le compte existe : meme retour (undefined), jamais d'exception pour un compte inconnu. */
export async function demanderReinitialisation(email: string): Promise<void> {
  try {
    const adresse = normaliserEmail(email)
    if (!emailValide(adresse)) return
    if (!urlPubliqueConfiguree()) {
      journal.erreur('URL publique absente pour la réinitialisation', { domaine: 'comptes', action: 'reinitialisation_url_absente' })
      return
    }
    const resultat = await prisma.$transaction(async tx => {
      const compte = await tx.user.findFirst({ where: { email: adresse, status: 'active', deletedAt: null } })
      if (!compte || (await compteLieOidc(tx, compte.id))) return null
      // Verrou par compte : deux demandes simultanees ne depassent pas la limite horaire.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'datagenius:comptes:reinit:' + compte.id}, 0))::text`
      const recentes = await tx.compteJeton.count({
        where: { userId: compte.id, type: 'reinitialisation', creeA: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
      })
      if (limiteDemandesAtteinte(recentes)) return null
      return { compte, jeton: (await creerJeton(tx, compte.id, 'reinitialisation', REINITIALISATION_VALIDITE_MS, null)).jeton }
    })
    if (!resultat) return
    journaliser('reinitialisation_demandee', null, resultat.compte.id)
    // Sans attente : le delai de reponse ne depend pas de l'existence du compte. envoyerMail ne leve jamais.
    void Promise.resolve(envoyerReinitialisation(
      { email: resultat.compte.email, prenom: resultat.compte.firstName }, lienDefinitionMotDePasse(resultat.jeton),
    )).catch(() => undefined)
  } catch (erreur) {
    // Meme reponse dans tous les cas ; l'erreur technique est journalisee sans donnee personnelle.
    journal.erreur('Erreur lors de la réinitialisation', {
      domaine: 'comptes', action: 'reinitialisation_erreur', erreur: erreur instanceof Error ? erreur.name : 'inconnue',
    })
  }
}

function etatCompatible(type: string, compte: { status: string; deletedAt: Date | null }, oidc: boolean): boolean {
  if (compte.deletedAt) return false
  if (type === 'invitation') return compte.status === 'invited'
  if (type === 'reinitialisation') return compte.status === 'active' && !oidc
  return false
}

export async function verifierJeton(jeton: string): Promise<ResultatJeton> {
  if (typeof jeton !== 'string' || jeton.length === 0 || jeton.length > 512) return { valide: false }
  const ligne = await prisma.compteJeton.findUnique({ where: { hash: hacherJeton(jeton) }, include: { user: true } })
  if (!ligne || !jetonUtilisable(ligne)) return { valide: false }
  if (!etatCompatible(ligne.type, ligne.user, await compteLieOidc(prisma, ligne.userId))) return { valide: false }
  return { valide: true, type: ligne.type as 'invitation' | 'reinitialisation', prenom: ligne.user.firstName }
}

/** Leve ErreurComptes (message affichable) si le jeton est invalide/expire/utilise ou le mot de passe trop court. */
export async function definirMotDePasse(jeton: string, motDePasse: string): Promise<void> {
  validerMotDePasse(motDePasse)
  if (typeof jeton !== 'string' || jeton.length === 0 || jeton.length > 512) throw new ErreurComptes(MESSAGE_LIEN_INVALIDE)
  const passwordHash = await hashPassword(motDePasse)
  const compteId = await prisma.$transaction(async tx => {
    const ligne = await tx.compteJeton.findUnique({ where: { hash: hacherJeton(jeton) } })
    if (!ligne) throw new ErreurComptes(MESSAGE_LIEN_INVALIDE)
    const maintenant = new Date()
    const revendique = await tx.compteJeton.updateMany({
      where: { id: ligne.id, utiliseA: null, expireA: { gt: maintenant } }, data: { utiliseA: maintenant },
    })
    if (revendique.count !== 1) throw new ErreurComptes(MESSAGE_LIEN_INVALIDE)
    const compte = await tx.user.findUnique({ where: { id: ligne.userId } })
    if (!compte || !etatCompatible(ligne.type, compte, await compteLieOidc(tx, compte.id))) {
      throw new ErreurComptes(MESSAGE_LIEN_INVALIDE)
    }
    // Activation conditionnee a l'etat attendu, dans la meme transaction que la revendication du jeton :
    // une desactivation concurrente n'est jamais ecrasee (aucune ligne mise a jour -> transaction annulee).
    const statutAttendu = ligne.type === 'invitation' ? 'invited' : 'active'
    const active = await tx.user.updateMany({
      where: { id: compte.id, status: statutAttendu, deletedAt: null }, data: { passwordHash, status: 'active' },
    })
    if (active.count !== 1) throw new ErreurComptes(MESSAGE_LIEN_INVALIDE)
    await invaliderJetons(tx, compte.id)
    return compte.id
  })
  journaliser('mot_de_passe_defini', null, compteId)
}
