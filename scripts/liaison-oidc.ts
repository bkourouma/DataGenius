import { prisma } from '@/lib/db/client'
import { configurationOidc, lierIdentiteOidc } from '@/lib/auth/oidc'

async function main() {
  const config = configurationOidc()
  const email = process.env.DATAGENIUS_OIDC_EMAIL?.trim().toLowerCase()
  if (!config || !email) throw new Error('Configurez OpenID Connect et indiquez DATAGENIUS_OIDC_EMAIL.')
  if (process.argv.includes('--retirer')) {
    await prisma.$executeRaw`
      DELETE FROM public.identites_oidc WHERE emetteur = ${config.emetteur}
        AND utilisateur_id IN (SELECT id FROM public.users WHERE email = ${email})
    `
    console.log('Identité OpenID Connect retirée.')
  } else {
    await lierIdentiteOidc(config.emetteur, process.env.DATAGENIUS_OIDC_SUBJECT ?? '', email)
    console.log('Identité OpenID Connect liée.')
  }
}

main().catch(erreur => {
  const message = erreur instanceof Error && !('code' in erreur) ? erreur.message : 'Modification de l’identité impossible.'
  console.error(message)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
