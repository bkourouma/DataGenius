import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import { contexteDepuisCompte } from '@/lib/medic-assist/suivi/comptes'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'
import { chargerTableau, dupliquerTableau, enregistrerTableau, restaurerVersion } from '@/lib/warehouse/tableaux'
import type { DefinitionTableau } from '@/lib/warehouse/tableaux-modeles'

const WEBHOOK = 'https://hooks.example.org/alerte'
const AUTRE_WEBHOOK = 'https://hooks.example.org/autre'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Alertes de tableaux à l’enregistrement', () => {
  afterAll(async () => Promise.all([prisma.$disconnect(), deconnecterPostgres()]))

  it('contrôle webhook et destinataires, nettoie à la restauration et masque les alertes aux lecteurs', async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') throw new Error('Utiliser la base fictive dg_app.')
    const comptes: string[] = []
    const tableaux: string[] = []
    async function creerCompte(roleName: string) {
      const compte = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, firstName: 'Alerte', passwordHash: 'fixture', roleName } })
      comptes.push(compte.id)
      const contexte = await contexteDepuisCompte(compte.id)
      if (!contexte) throw new Error('Compte de test inaccessible')
      return contexte
    }
    const tuileAvec = (id: string, alerte: Record<string, unknown>) =>
      ({ id, type: 'mesure' as const, jeu: 'ventes', mesure: 'ca_eur', dimensions: [] as string[], alerte: { sens: 'au_dessus' as const, seuil: '1', ...alerte } })
    try {
      await synchroniserEntrepot({ jeu: 'ventes' })
      const admin = await creerCompte('TenantAdmin')
      const membre = await creerCompte('Member')
      const lecteurA = await creerCompte('Member')
      const lecteurB = await creerCompte('Member')
      const idTuile = randomUUID()

      // 1. Webhook : refusé pour un non-administrateur, accepté pour un administrateur.
      const avecWebhook: DefinitionTableau = { titre: 'Webhook', lecteurs: [], tuiles: [tuileAvec(idTuile, { webhook: WEBHOOK })] }
      await expect(enregistrerTableau(membre, avecWebhook)).rejects.toThrow('administrateur')
      const idAdmin = await enregistrerTableau(admin, { ...avecWebhook, lecteurs: [lecteurA.userId], tuiles: [tuileAvec(idTuile, { webhook: WEBHOOK, destinataires: [lecteurA.userId] })] })
      tableaux.push(idAdmin)

      // 2. Webhook inchangé accepté, ajouté ou changé refusé (tableau d’un non-administrateur portant déjà un webhook).
      const sansWebhook: DefinitionTableau = { titre: 'Membre', lecteurs: [], tuiles: [tuileAvec(idTuile, {})] }
      const idMembre = await enregistrerTableau(membre, sansWebhook)
      tableaux.push(idMembre)
      await expect(enregistrerTableau(membre, { ...sansWebhook, tuiles: [tuileAvec(idTuile, { webhook: WEBHOOK })] }, { id: idMembre, version: 1 }))
        .rejects.toThrow('administrateur')
      await prisma.$executeRaw`
        UPDATE warehouse.tableaux SET definition = ${JSON.stringify({ ...sansWebhook, tuiles: [tuileAvec(idTuile, { webhook: WEBHOOK })] })}::jsonb
        WHERE id = ${idMembre}::uuid
      `
      await enregistrerTableau(membre, { ...sansWebhook, titre: 'Membre renommé', tuiles: [tuileAvec(idTuile, { webhook: WEBHOOK })] }, { id: idMembre, version: 1 })
      await expect(enregistrerTableau(membre, { ...sansWebhook, tuiles: [tuileAvec(idTuile, { webhook: AUTRE_WEBHOOK })] }, { id: idMembre, version: 2 }))
        .rejects.toThrow('administrateur')
      // Même adresse mais sur une autre tuile : refusé.
      await expect(enregistrerTableau(membre, { ...sansWebhook, tuiles: [tuileAvec(randomUUID(), { webhook: WEBHOOK })] }, { id: idMembre, version: 2 }))
        .rejects.toThrow('administrateur')

      // 3. Destinataire non lecteur refusé.
      await expect(enregistrerTableau(membre, { titre: 'Destinataire', lecteurs: [lecteurA.userId], tuiles: [tuileAvec(idTuile, { destinataires: [lecteurB.userId] })] }))
        .rejects.toThrow('lecteur du tableau')

      // 4. Restauration : le destinataire devenu non lecteur est retiré, la restauration aboutit.
      const v1: DefinitionTableau = { titre: 'Restauration', lecteurs: [lecteurA.userId, lecteurB.userId],
        tuiles: [tuileAvec(idTuile, { destinataires: [lecteurA.userId, lecteurB.userId] })] }
      const idRestauration = await enregistrerTableau(membre, v1)
      tableaux.push(idRestauration)
      await enregistrerTableau(membre, { ...v1, lecteurs: [lecteurA.userId], tuiles: [tuileAvec(idTuile, { destinataires: [lecteurA.userId] })] }, { id: idRestauration, version: 1 })
      await restaurerVersion(membre, idRestauration, 1, 2)
      const restauree = await chargerTableau(idRestauration, membre)
      expect(restauree?.version).toBe(3)
      expect(restauree?.definition.lecteurs).toEqual([lecteurA.userId])
      expect(restauree?.definition.tuiles[0]).toMatchObject({ alerte: { destinataires: [lecteurA.userId] } })

      // 5. Un lecteur non propriétaire ne reçoit ni webhook ni destinataires ; le propriétaire les garde.
      const vueLecteur = await chargerTableau(idAdmin, lecteurA)
      expect(vueLecteur?.editable).toBe(false)
      const alerteLecteur = (vueLecteur!.definition.tuiles[0] as { alerte: Record<string, unknown> }).alerte
      expect(alerteLecteur).toEqual({ sens: 'au_dessus', seuil: '1' })
      expect(JSON.stringify(vueLecteur)).not.toContain(WEBHOOK)
      const vueProprietaire = await chargerTableau(idAdmin, admin)
      expect(vueProprietaire?.definition.tuiles[0]).toMatchObject({ alerte: { webhook: WEBHOOK, destinataires: [lecteurA.userId] } })

      // 6. Duplication : destinataires retirés ; webhook conservé pour un TenantAdmin seulement.
      const copieAdmin = await dupliquerTableau(admin, idAdmin)
      tableaux.push(copieAdmin)
      expect((await chargerTableau(copieAdmin, admin))?.definition.tuiles[0]).toMatchObject({ alerte: { webhook: WEBHOOK } })
      expect(JSON.stringify((await chargerTableau(copieAdmin, admin))?.definition)).not.toContain(lecteurA.userId)
      const copieRestauree = await dupliquerTableau(membre, idRestauration)
      tableaux.push(copieRestauree)
      expect((await chargerTableau(copieRestauree, membre))?.definition.tuiles[0]).toMatchObject({ alerte: { sens: 'au_dessus', seuil: '1' } })
      expect(JSON.stringify((await chargerTableau(copieRestauree, membre))?.definition)).not.toContain('destinataires')
      const idMembreWebhook = await enregistrerTableau(membre, sansWebhook)
      tableaux.push(idMembreWebhook)
      await prisma.$executeRaw`
        UPDATE warehouse.tableaux SET definition = ${JSON.stringify({ ...sansWebhook, tuiles: [tuileAvec(idTuile, { webhook: WEBHOOK })] })}::jsonb
        WHERE id = ${idMembreWebhook}::uuid
      `
      const copieMembre = await dupliquerTableau(membre, idMembreWebhook)
      tableaux.push(copieMembre)
      expect(JSON.stringify((await chargerTableau(copieMembre, membre))?.definition)).not.toContain('webhook')
    } finally {
      await prisma.$executeRaw`DELETE FROM warehouse.tableaux WHERE id = ANY(${tableaux}::uuid[])`
      await prisma.user.deleteMany({ where: { id: { in: comptes } } })
    }
  }, 60_000)
})
