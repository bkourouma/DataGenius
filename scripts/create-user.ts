import { prisma } from '@/lib/db/client'
import { hashPassword } from '@/lib/auth/password'

async function main() {
  const email = process.env.DATAGENIUS_USER_EMAIL?.trim().toLowerCase()
  const password = process.env.DATAGENIUS_USER_PASSWORD
  const firstName = process.env.DATAGENIUS_USER_NAME?.trim() || 'Data Genius'
  const roleName = process.env.DATAGENIUS_USER_ROLE ?? 'Member'
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !password || password.length < 12 || password.length > 256 ||
      !['Member', 'TenantAdmin'].includes(roleName)) {
    throw new Error('Indiquez un e-mail, un mot de passe de 12 à 256 caractères et un rôle valide.')
  }
  await prisma.user.create({ data: { email, firstName, passwordHash: await hashPassword(password), roleName } })
  console.log('Compte Data Genius créé.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Création du compte impossible.')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
