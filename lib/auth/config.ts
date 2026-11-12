import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/db/client'
import { verifyPassword } from './password'
import { configurationOidc, FOURNISSEUR_OIDC, fournisseurOidc, trouverUtilisateurOidc } from './oidc'

const oidc = configurationOidc()

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      credentials: { email: { type: 'email' }, password: { type: 'password' } },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase()
        const password = credentials?.password
        if (!email || !password || email.length > 254 || password.length > 256) return null
        const user = await prisma.user.findFirst({
          where: { email, status: 'active', deletedAt: null },
        })
        if (!user || !verifyPassword(password, user.passwordHash)) return null
        return {
          id: user.id,
          email: user.email,
          name: [user.firstName, user.lastName].filter(Boolean).join(' '),
          roleName: user.roleName,
        }
      },
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
