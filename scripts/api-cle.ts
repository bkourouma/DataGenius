import { prisma } from '@/lib/db/client'
import { creerCleApi, revoquerCleApi, tournerCleApi } from '@/lib/integration/cles-api'

async function main() {
  const [action, argument, libelle, jours] = process.argv.slice(2)
  if (action === 'creer' && argument && libelle) {
    const utilisateur = await prisma.user.findUnique({ where: { email: argument.trim().toLowerCase() }, select: { id: true } })
    if (!utilisateur) throw new Error('Compte indisponible.')
    return creerCleApi(utilisateur.id, libelle, jours === undefined ? 30 : Number(jours))
  }
  if (action === 'revoquer' && argument && !libelle) {
    return { revoquee: await revoquerCleApi(argument) }
  }
  if (action === 'tourner' && argument && !jours) {
    return tournerCleApi(argument, libelle === undefined ? 30 : Number(libelle))
  }
  throw new Error('Commandes : creer <email> <libellé> [jours], revoquer <id>, tourner <id> [jours].')
}

main().then(resultat => console.log(JSON.stringify(resultat))).catch(() => {
  console.error('Vérifiez la commande, le compte, l’identifiant et la durée (1 à 90 jours).')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
