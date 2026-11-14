import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/db/client'
import { doitRehacher, hashPassword, verifierFauxMotDePasse, verifyPassword } from './password'
import { extraireIp, reinitialiser, reserverTentative, sautsProxyDeConfiance } from './limite-connexion'
import { configurationOidc, FOURNISSEUR_OIDC, fournisseurOidc, trouverUtilisateurOidc } from './oidc'

const oidc = configurationOidc()

type Identifiants = Record<'email' | 'password', string> | undefined
type RequeteAuth = { headers?: Record<string, string | string[] | undefined> } | undefined

export async function autoriserConnexion(credentials: Identifiants, req?: RequeteAuth) {
  const email = credentials?.email?.trim().toLowerCase()
  const password = credentials?.password
  if (!email || !password || email.length > 254 || password.length > 256) return null
  // Sans DATAGENIUS_PROXY_DE_CONFIANCE, l'IP est ignorée (en-têtes forgeables) : limite par e-mail seule.
  const ip = extraireIp(req?.headers, sautsProxyDeConfiance())
  // La tentative est réservée (incrément atomique) AVANT tout hachage : des requêtes simultanées ne
  // peuvent pas dépasser le seuil. Contrat avec l'écran de connexion : cette erreur exacte signale un blocage.
  if (!await reserverTentative({ email, ip })) throw new Error('trop_de_tentatives')
  const user = await prisma.user.findFirst({
    where: { email, status: 'active', deletedAt: null },
  })
  if (!user) {
    // Même coût qu'un vrai compte ; la tentative réservée reste comptée comme un échec.
    await verifierFauxMotDePasse(password)
    return null
  }
  if (!await verifyPassword(password, user.passwordHash)) return null
  await reinitialiser({ email, ip })
  if (doitRehacher(user.passwordHash)) {
    try {
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
    } catch {
      // Un échec de rehachage ne doit pas empêcher la connexion.
    }
  }
  return {
    id: user.id,
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(' '),
    roleName: user.roleName,
  }
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      credentials: { email: { type: 'email' }, password: { type: 'password' } },
      authorize: autoriserConnexion,
    }),
    ...(oidc ? [fournisseurOidc(oidc)] : []),
  ],
  callbacks: {
    async signIn({ account }) {
      if (account?.provider !== FOURNISSEUR_OIDC) return true
      return Boolean(oidc && await trouverUtilisateurOidc(oidc.emetteur, account.providerAccountId))
    },
    async jwt({ token, user, account }) {
      if (account?.provider === FOURNISSEUR_OIDC) {
        token.emetteurOidc = oidc?.emetteur
        token.sujetOidc = account.providerAccountId
      }
      if (token.sujetOidc !== undefined) {
        const utilisateur = oidc && oidc.emetteur === token.emetteurOidc
          ? await trouverUtilisateurOidc(oidc.emetteur, token.sujetOidc) : null
        const utilisateurConnu = utilisateur && (account || token.sub === utilisateur.id) ? utilisateur : null
        return { ...token, sub: utilisateurConnu?.id ?? '', roleName: utilisateurConnu?.roleName ?? 'Member',
          email: utilisateurConnu?.email, name: utilisateurConnu?.nom }
      }
      if (user) token.roleName = user.roleName
      return token
    },
    session({ session, token }) {
      session.user.id = token.sub ?? ''
      session.user.roleName = token.roleName
      session.user.habilitations = null
      return session
    },
  },
}
