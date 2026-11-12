import type { OAuthConfig } from 'next-auth/providers/oauth'
import { prisma } from '@/lib/db/client'

type Profil = { sub: string; iss: string }

export const FOURNISSEUR_OIDC = 'entreprise'

export function configurationOidc(env = process.env) {
  const emetteur = env.DATAGENIUS_OIDC_ISSUER?.trim()
  const clientId = env.DATAGENIUS_OIDC_CLIENT_ID?.trim()
  const clientSecret = env.DATAGENIUS_OIDC_CLIENT_SECRET
  if (!emetteur || !clientId || !clientSecret) return null
  const url = URL.parse(emetteur)
  const local = url?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!url || (url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) return null
  return { emetteur, clientId, clientSecret }
}

export function fournisseurOidc(config: NonNullable<ReturnType<typeof configurationOidc>>): OAuthConfig<Profil> {
  return {
    id: FOURNISSEUR_OIDC, name: 'Connexion entreprise', type: 'oauth',
    issuer: config.emetteur, wellKnown: config.emetteur.replace(/\/$/, '') + '/.well-known/openid-configuration',
    clientId: config.clientId, clientSecret: config.clientSecret,
    authorization: { params: { scope: 'openid' } },
    idToken: true, checks: ['pkce', 'state', 'nonce'],
    profile(profil) {
      if (!sujetValide(profil.sub) || profil.iss !== config.emetteur) throw new Error('Identité OpenID Connect invalide.')
      return { id: profil.sub, roleName: 'Member' }
    },
  }
}

function sujetValide(sujet: unknown): sujet is string {
  return typeof sujet === 'string' && sujet.length > 0 && sujet.length <= 255 && !/[\u0000-\u001f\u007f]/.test(sujet)
}

export async function trouverUtilisateurOidc(emetteur: string, sujet: unknown) {
  if (!sujetValide(sujet)) return null
  const [utilisateur] = await prisma.$queryRaw<{ id: string; email: string; nom: string; roleName: string }[]>`
    SELECT u.id, u.email, trim(concat(u."firstName", ' ', u."lastName")) AS nom, u."roleName"
    FROM public.identites_oidc AS i JOIN public.users AS u ON i.utilisateur_id = u.id
    WHERE i.emetteur = ${emetteur} AND i.sujet = ${sujet} AND u.status = 'active' AND u."deletedAt" IS NULL
  `
  return utilisateur ?? null
}

export async function lierIdentiteOidc(emetteur: string, sujet: string, email: string) {
  if (!sujetValide(sujet)) throw new Error('Sujet OpenID Connect invalide.')
  const lignes = await prisma.$executeRaw`
    INSERT INTO public.identites_oidc (emetteur, sujet, utilisateur_id)
    SELECT ${emetteur}, ${sujet}, id FROM public.users
    WHERE email = ${email} AND status = 'active' AND "deletedAt" IS NULL
    ON CONFLICT (emetteur, sujet) DO UPDATE SET sujet = EXCLUDED.sujet
      WHERE identites_oidc.utilisateur_id = EXCLUDED.utilisateur_id
  `
  if (lignes !== 1) throw new Error('Compte actif introuvable ou sujet déjà attribué.')
}
