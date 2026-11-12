import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/db/client'
import { verifyPassword } from './password'

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
  ],
  callbacks: {
    jwt({ token, user }) {
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
