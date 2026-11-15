import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { getAccessScope } from '@/lib/auth/access-scope'
import {
  ajouterCommentaire,
  FENETRE_LIMITE_MINUTES,
  LIMITE_COMMENTAIRES,
  listerCommentaires,
  supprimerCommentaire,
} from '@/lib/commentaires/commentaires'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'

async function code(promesse: Promise<unknown>) {
  try {
    await promesse
  } catch (erreur) {
    return (erreur as { code?: string }).code ?? 'autre'
  }
  return 'aucune'
}

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Commentaires sur une analyse', () => {
  afterAll(async () => Promise.all([prisma.$disconnect(), deconnecterPostgres()]))

  it('applique la visibilité des analyses, les droits de suppression et la limite de débit', async () => {
    const users: string[] = []
    async function creerCompte(roleName = 'Member', prenom = 'Recette') {
      const compte = await prisma.user.create({
        data: { email: `${randomUUID()}@example.test`, firstName: prenom, lastName: 'Test', roleName, passwordHash: 'fixture' },
      })
      users.push(compte.id)
      return compte.id
    }
    async function contexte(userId: string): Promise<ContexteExecution> {
      const scope = await getAccessScope(userId)
      if (!scope) throw new Error('Compte indisponible')
      return { userId, roleName: scope.roleName, scope, habilitations: null, locale: 'fr', maintenant: new Date() }
    }
    const racineId = randomUUID()
    try {
      const proprio = await creerCompte('Member', 'Proprio')
      const destinataire = await creerCompte()
      const tiers = await creerCompte()
      const admin = await creerCompte('TenantAdmin', 'Admin')
      const artefact = await prisma.assistantArtefact.create({
        data: { id: racineId, racineId, userId: proprio, type: 'tableau', titre: 'Analyse de recette', spec: {}, jeuxDeDonneesIds: [] },
      })
      expect(artefact.racineId).toBe(racineId)
      const partage = await prisma.assistantPartage.create({
        data: { ressourceType: 'artefact', ressourceId: racineId, deUserId: proprio, aUserId: destinataire },
      })
      const cProprio = await contexte(proprio)
      const cDest = await contexte(destinataire)
      const cTiers = await contexte(tiers)
      const cAdmin = await contexte(admin)

      // Le propriétaire commente et relit ; le HTML reste du texte.
      const premier = await ajouterCommentaire(cProprio, racineId, '  <script>x</script>  ')
      const lu = await listerCommentaires(cProprio, racineId)
      expect(lu).toHaveLength(1)
      expect(lu[0]).toMatchObject({ id: premier.id, texte: '<script>x</script>', auteurId: proprio, supprimable: true })
      expect(lu[0].auteurNom).toBe('Proprio Test')

      // Le destinataire du partage lit et commente ; il ne peut pas supprimer le commentaire d'autrui.
      const secondTexte = 'Ligne 1\r\nLigne 2'
      const second = await ajouterCommentaire(cDest, racineId, secondTexte)
      const vueDest = await listerCommentaires(cDest, racineId)
      expect(vueDest.map((c) => c.texte)).toEqual(['<script>x</script>', 'Ligne 1\nLigne 2'])
      expect(vueDest.map((c) => c.supprimable)).toEqual([false, true])
      expect(await code(supprimerCommentaire(cDest, premier.id))).toBe('interdit')

      // Un tiers sans partage ne voit rien et ne révèle rien.
      expect(await code(listerCommentaires(cTiers, racineId))).toBe('introuvable')
      expect(await code(ajouterCommentaire(cTiers, racineId, 'intrus'))).toBe('introuvable')
      expect(await code(supprimerCommentaire(cTiers, premier.id))).toBe('introuvable')
      expect(await code(supprimerCommentaire(cTiers, randomUUID()))).toBe('introuvable')
      expect(await code(listerCommentaires(cProprio, randomUUID()))).toBe('introuvable')

      // Textes invalides.
      expect(await code(ajouterCommentaire(cProprio, racineId, 'a'.repeat(2001)))).toBe('invalide')
      expect(await code(ajouterCommentaire(cProprio, racineId, ' \n '))).toBe('invalide')
      expect((await ajouterCommentaire(cProprio, racineId, 'a'.repeat(2000))).id).toBeTruthy()

      // Suppression par l'auteur, puis par un TenantAdmin (qui ne voit pas l'analyse).
      await supprimerCommentaire(cDest, second.id)
      expect(await code(supprimerCommentaire(cDest, second.id))).toBe('introuvable')
      expect((await listerCommentaires(cProprio, racineId)).map((c) => c.id)).not.toContain(second.id)
      const modere = await supprimerCommentaire(cAdmin, premier.id)
      expect(modere.artefactId).toBe(racineId)
      expect((await listerCommentaires(cProprio, racineId)).map((c) => c.id)).not.toContain(premier.id)

      // Le retrait du partage retire la visibilité du destinataire.
      await prisma.assistantPartage.delete({ where: { id: partage.id } })
      expect(await code(listerCommentaires(cDest, racineId))).toBe('introuvable')
      expect(await code(ajouterCommentaire(cDest, racineId, 'après retrait'))).toBe('introuvable')

      // Limite de débit : au plus LIMITE_COMMENTAIRES par auteur sur la fenêtre (le destinataire en a 1).
      const restant = LIMITE_COMMENTAIRES - (await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM warehouse.commentaires_analyses
        WHERE auteur_id = ${proprio} AND cree_a > clock_timestamp() - make_interval(mins => ${FENETRE_LIMITE_MINUTES}::int)`)[0].n
      for (let i = 0; i < restant; i++) await ajouterCommentaire(cProprio, racineId, `commentaire ${i}`)
      expect(await code(ajouterCommentaire(cProprio, racineId, 'un de trop'))).toBe('limite_debit')
      // Un autre auteur n'est pas bloqué, et un commentaire ancien sort de la fenêtre.
      await prisma.$executeRaw`UPDATE warehouse.commentaires_analyses SET cree_a = clock_timestamp() - interval '11 minutes'
        WHERE auteur_id = ${proprio}`
      expect((await ajouterCommentaire(cProprio, racineId, 'fenêtre écoulée')).id).toBeTruthy()
    } finally {
      await prisma.$executeRaw`DELETE FROM warehouse.commentaires_analyses WHERE artefact_id = ${racineId}`
      await prisma.assistantPartage.deleteMany({ where: { ressourceId: racineId } })
      await prisma.assistantArtefact.deleteMany({ where: { racineId } })
      await prisma.user.deleteMany({ where: { id: { in: users } } })
    }
  })
})
