import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { getAccessScope } from '@/lib/auth/access-scope'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { registreAutorise } from '@/lib/medic-assist/donnees/catalogue/autorisation'
import { creerGroupe, modifierGroupe, modifierRegle } from '@/lib/warehouse/droits-admin'
import { enregistrerEspace, listerEspaces } from '@/lib/warehouse/espaces'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Espaces et droits des jeux', () => {
  afterAll(() => prisma.$disconnect())

  it('combine les accès de l’espace et du jeu puis applique la révocation', async () => {
    const acteur = randomUUID()
    const groupeEspace = 'Espace ' + acteur
    const groupeJeu = 'Jeu ' + acteur
    const compte = await prisma.user.create({ data: { email: acteur + '@example.test', firstName: 'Recette', passwordHash: 'fixture' } })
    const jeu = 'ventes'
    let espace: string | undefined
    let groupeA: string | undefined
    let groupeB: string | undefined
    async function contexte(): Promise<ContexteExecution> {
      const scope = await getAccessScope(compte.id)
      if (!scope) throw new Error('Compte fictif indisponible.')
      return { scope, roleName: scope.roleName, userId: compte.id, habilitations: null, locale: 'fr', maintenant: new Date() }
    }
    const visible = async () => (await registreAutorise(await contexte())).some(e => e.jeu.cle === jeu)
    try {
      groupeA = await creerGroupe(acteur, groupeEspace)
      groupeB = await creerGroupe(acteur, groupeJeu)
      const definition = { nom: 'Pilote ' + acteur, description: 'Un espace de données fictives', groupes: [groupeA], jeux: [jeu] }
      espace = await enregistrerEspace(acteur, null, 0, definition)
      await modifierRegle(acteur, jeu, { groupes: [groupeB], masquer: [], filtre: null })
      await modifierGroupe(acteur, groupeA, groupeEspace, [compte.id])
      expect(await visible()).toBe(false)
      expect(await listerEspaces(await contexte())).toEqual([])
      await modifierGroupe(acteur, groupeB, groupeJeu, [compte.id])
      expect(await visible()).toBe(true)
      expect(await listerEspaces(await contexte())).toMatchObject([{ id: espace, jeux: [{ cle: jeu }] }])
      await enregistrerEspace(acteur, espace, 1, { ...definition, groupes: [] })
      await expect(enregistrerEspace(acteur, espace, 1, definition)).rejects.toThrow('L’espace a changé')
      expect(await visible()).toBe(false)
    } finally {
      await prisma.$executeRaw`DELETE FROM warehouse.regles_acces WHERE jeu = ${jeu}`
      if (espace) await prisma.$executeRaw`DELETE FROM warehouse.espaces WHERE id = ${espace}::uuid`
      if (groupeA) await prisma.$executeRaw`DELETE FROM warehouse.groupes_acces WHERE id = ${groupeA}::uuid`
      if (groupeB) await prisma.$executeRaw`DELETE FROM warehouse.groupes_acces WHERE id = ${groupeB}::uuid`
      await prisma.$executeRaw`DELETE FROM warehouse.audit_acces WHERE acteur_id = ${acteur}`
      await prisma.user.delete({ where: { id: compte.id } })
    }
  })
})
