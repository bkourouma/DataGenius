import { createHash, randomBytes } from 'node:crypto'

export const ROLES_COMPTE = ['Member', 'TenantAdmin'] as const
export type RoleCompte = (typeof ROLES_COMPTE)[number]

/** Erreur metier dont le message (francais) peut etre affiche tel quel a l'administrateur. */
export class ErreurComptes extends Error {}

export const INVITATION_VALIDITE_MS = 7 * 24 * 60 * 60 * 1000
export const REINITIALISATION_VALIDITE_MS = 60 * 60 * 1000
export const MAX_DEMANDES_PAR_HEURE = 3
export const MOT_DE_PASSE_MIN = 12
export const MOT_DE_PASSE_MAX = 256
export const MESSAGE_LIEN_INVALIDE = 'Ce lien est invalide ou a expiré. Demandez-en un nouveau.'

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Jeton clair : 32 octets aleatoires, 43 caracteres base64url. Jamais stocke. */
export function genererJeton(): string {
  return randomBytes(32).toString('base64url')
}

/** Empreinte SHA-256 hexadecimale : seule valeur conservee en base. */
export function hacherJeton(jeton: string): string {
  return createHash('sha256').update(jeton, 'utf8').digest('hex')
}

export function jetonUtilisable(jeton: { expireA: Date; utiliseA: Date | null }, maintenant: Date = new Date()): boolean {
  return jeton.utiliseA === null && jeton.expireA.getTime() > maintenant.getTime()
}

export function limiteDemandesAtteinte(nbDemandesDerniereHeure: number): boolean {
  return nbDemandesDerniereHeure >= MAX_DEMANDES_PAR_HEURE
}

export function validerMotDePasse(motDePasse: string): void {
  if (typeof motDePasse !== 'string' || motDePasse.length < MOT_DE_PASSE_MIN || motDePasse.length > MOT_DE_PASSE_MAX) {
    throw new ErreurComptes(`Le mot de passe doit contenir entre ${MOT_DE_PASSE_MIN} et ${MOT_DE_PASSE_MAX} caractères.`)
  }
}

export function normaliserEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase()
}

export function emailValide(email: string): boolean {
  return email.length <= 254 && REGEX_EMAIL.test(email)
}

/** Normalise puis valide ; leve ErreurComptes. */
export function validerEmail(email: string): string {
  const normalise = normaliserEmail(email)
  if (!emailValide(normalise)) throw new ErreurComptes('Indiquez une adresse e-mail valide.')
  return normalise
}

export function validerRole(role: string): RoleCompte {
  if (!(ROLES_COMPTE as readonly string[]).includes(role)) throw new ErreurComptes('Rôle inconnu.')
  return role as RoleCompte
}

export function validerIdentite(prenom: string, nom: string): { prenom: string; nom: string } {
  const p = String(prenom ?? '').trim()
  const n = String(nom ?? '').trim()
  if (p.length < 1 || p.length > 80) throw new ErreurComptes('Le prénom est obligatoire (80 caractères au plus).')
  if (n.length > 80) throw new ErreurComptes('Le nom ne doit pas dépasser 80 caractères.')
  return { prenom: p, nom: n }
}

/** Base publique (NEXTAUTH_URL, sinon APP_URL), sans slash final ; null si absente. */
export function urlPubliqueConfiguree(env: NodeJS.ProcessEnv = process.env): string | null {
  const valeur = env.NEXTAUTH_URL?.trim() || env.APP_URL?.trim()
  return valeur ? valeur.replace(/\/+$/, '') : null
}

export function lienDefinitionMotDePasse(jeton: string): string {
  const base = urlPubliqueConfiguree()
  if (!base) throw new ErreurComptes("NEXTAUTH_URL n'est pas configurée : impossible de construire un lien d'invitation.")
  return `${base}/definir-mot-de-passe?jeton=${encodeURIComponent(jeton)}`
}

export interface CibleCompte {
  id: string
  roleName: string
  /** Valeur de User.status. */
  status: string
}

const estAdminActif = (c: CibleCompte) => c.roleName === 'TenantAdmin' && c.status === 'active'

/** `adminsActifs` : nombre de TenantAdmin actifs en base, relu dans la transaction. */
export function verifierDesactivation(acteurId: string, cible: CibleCompte, adminsActifs: number): void {
  if (cible.id === acteurId) throw new ErreurComptes('Vous ne pouvez pas désactiver votre propre compte.')
  if (estAdminActif(cible) && adminsActifs <= 1) {
    throw new ErreurComptes("Impossible de désactiver le dernier administrateur actif.")
  }
}

export function verifierChangementRole(acteurId: string, cible: CibleCompte, nouveauRole: string, adminsActifs: number): void {
  validerRole(nouveauRole)
  if (cible.roleName === nouveauRole) return
  if (estAdminActif(cible) && nouveauRole !== 'TenantAdmin' && adminsActifs <= 1) {
    throw new ErreurComptes(
      cible.id === acteurId
        ? 'Vous êtes le dernier administrateur actif : vous ne pouvez pas retirer votre propre rôle.'
        : 'Impossible de rétrograder le dernier administrateur actif.'
    )
  }
}

/** Un mot de passe local reel contient sel et condensat (ancien format <sel>.<hash> ou scrypt$...) ; '!' marque un compte sans mot de passe. */
export const HASH_INUTILISABLE = '!'
export function aMotDePasseLocal(passwordHash: string): boolean {
  return passwordHash !== HASH_INUTILISABLE && (passwordHash.includes('.') || passwordHash.startsWith('scrypt$'))
}
