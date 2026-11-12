import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import { creerArtefact } from '@/lib/medic-assist/artefacts/stockage'
import { interrogerDonnees } from '@/lib/medic-assist/donnees/outils'
import { contexteDepuisCompte } from '@/lib/medic-assist/suivi/comptes'
import { creerGroupe, modifierGroupe, modifierRegle } from '@/lib/warehouse/droits-admin'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'
import { chargerTableau, enregistrerTableau, lireTableau, listerTableaux } from '@/lib/warehouse/tableaux'
import { listerAlertesTableaux, traiterAlertesTableaux } from '@/lib/warehouse/tableaux-alertes'
import type { DefinitionTableau } from '@/lib/warehouse/tableaux-modeles'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Tableaux de bord', () => {
  afterAll(async () => Promise.all([prisma.$disconnect(), deconnecterPostgres()]))

  it('recalcule les tuiles selon le lecteur, applique le filtre et déduplique les alertes', async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') throw new Error('Utiliser la base fictive dg_app.')
    const comptes: string[] = []
    const acteur = randomUUID()
    let groupe: string | undefined
    async function creerCompte(roleName: string) {
      const compte = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, firstName: 'Tableau', passwordHash: 'fixture', roleName } })
      comptes.push(compte.id)
      const contexte = await contexteDepuisCompte(compte.id)
      if (!contexte) throw new Error('Compte de test inaccessible')
      return contexte
    }
    try {
      await synchroniserEntrepot({ jeu: 'ventes' })
      const proprietaire = await creerCompte('TenantAdmin')
      const lecteur = await creerCompte('Member')
      const exclu = await creerCompte('Member')
      const donnees = await interrogerDonnees(proprietaire, { jeu: 'ventes', mesures: ['ca_eur'] })
      const artefact = await creerArtefact(proprietaire, { spec: { type: 'tableau', titre: 'Tableau privé', jeuDeDonneesId: donnees.jeuDeDonneesId } })
      const tuile = { id: randomUUID(), type: 'mesure' as const, jeu: 'ventes', mesure: 'ca_eur', dimensions: ['agence'],
        objectif: '2000', alerte: { sens: 'au_dessus' as const, seuil: '3000' } }
      const definition: DefinitionTableau = { titre: 'Suivi du pilote', lecteurs: [lecteur.userId], tuiles: [tuile,
        { id: randomUUID(), type: 'artefact', artefact: artefact.artefactId }] }
      const tableau = await enregistrerTableau(proprietaire, definition)
      const partage = await lireTableau(tableau, lecteur)
      expect(partage?.tuiles[1]).toMatchObject({ type: 'indisponible' })
      expect(await chargerTableau(tableau, exclu)).toBeNull()
      expect(await listerTableaux(exclu)).toEqual([])
      await expect(enregistrerTableau(lecteur, { ...definition, tuiles: [tuile] }, { id: tableau, version: 1 })).rejects.toThrow('indisponible')

      const nom = `Tableaux ${randomUUID()}`
      groupe = await creerGroupe(acteur, nom)
      await modifierGroupe(acteur, groupe, nom, [lecteur.userId])
      await modifierRegle(acteur, 'ventes', { groupes: [groupe], masquer: [], filtre: { colonne: 'agence', valeur: 'Lagune' } })
      const restreint = (await contexteDepuisCompte(lecteur.userId))!
      const resultat = await lireTableau(tableau, restreint, { cle: 'mois', valeur: '2026-10' }, tuile.id)
      expect(resultat?.tuiles[0]).toMatchObject({ type: 'mesure', filtreApplique: true, resultat: {
        lignes: [{ agence: 'Lagune', ca_eur: 1280 }], provenance: { libelleSource: expect.any(String) },
      } })

      const bilans = await Promise.all([traiterAlertesTableaux(), traiterAlertesTableaux()])
      expect(bilans.map(b => b.erreurs)).toEqual([0, 0])
      expect(bilans.reduce((total, b) => total + b.notifications, 0)).toBe(1)
      await enregistrerTableau(proprietaire, { ...definition, titre: 'Suivi renommé' }, { id: tableau, version: 1 })
      await expect(enregistrerTableau(proprietaire, definition, { id: tableau, version: 1 })).rejects.toThrow('modifié')
      expect((await traiterAlertesTableaux()).notifications).toBe(0)
      expect(await prisma.notification.count({ where: { userId: proprietaire.userId, type: 'tableau_alerte' } })).toBe(1)
      expect(await listerAlertesTableaux(proprietaire)).toMatchObject([{ tableau, titre: 'Suivi renommé' }])
      expect(await listerAlertesTableaux(restreint)).toEqual([])
    } finally {
      if (groupe) {
        await prisma.$executeRaw`DELETE FROM warehouse.regles_acces WHERE jeu = 'ventes'`
        await prisma.$executeRaw`DELETE FROM warehouse.groupes_acces WHERE id = ${groupe}::uuid`
      }
      await prisma.$executeRaw`DELETE FROM warehouse.audit_acces WHERE acteur_id = ${acteur}`
      await prisma.notification.deleteMany({ where: { userId: { in: comptes } } })
      await prisma.user.deleteMany({ where: { id: { in: comptes } } })
    }
  }, 30_000)
})
