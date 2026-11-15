import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { getAccessScope } from '@/lib/auth/access-scope'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { publierCatalogueMetier } from '@/lib/warehouse/catalogue-metier'
import { modifierRegle } from '@/lib/warehouse/droits-admin'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { ajouterSource, creerImport } from '@/lib/warehouse/sources-admin'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'
import { analyserTendance, optionsTendances } from '@/lib/warehouse/tendances'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Tendances sur indicateurs autorisés', () => {
  it('charge la série mensuelle d’un indicateur publié et la masque après révocation', async () => {
    const url = new URL(process.env.DATAGENIUS_SOURCE_SUPPORT ?? '')
    const urlOwner = new URL(process.env.DATAGENIUS_TEST_SUPPORT_OWNER_URL ?? '')
    if (url.pathname !== '/dg_support' || urlOwner.pathname !== '/dg_support' || new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') {
      throw new Error('Utiliser les bases fictives de la recette.')
    }
    const support = new PrismaClient({ datasourceUrl: urlOwner.href })
    const acteur = randomUUID()
    const contexte: ContexteExecution = { userId: acteur, roleName: 'TenantAdmin', scope: { roleName: 'TenantAdmin', voitTout: true },
      habilitations: null, locale: 'fr', maintenant: new Date('2027-03-12T12:00:00Z') }
    let source: string | undefined
    let jeu: string | undefined
    let compte: string | undefined
    let tableCreee = false
    try {
      await support.$executeRaw`CREATE TABLE support.tendances_fixture (observe_le date PRIMARY KEY, montant numeric NOT NULL)`
      tableCreee = true
      await support.$executeRaw`
        INSERT INTO support.tendances_fixture
        SELECT make_date(2026, mois, 1), CASE WHEN mois = 11 THEN 55 ELSE 10 END FROM generate_series(1, 12) AS mois`
      await support.$executeRaw`GRANT SELECT ON support.tendances_fixture TO dg_support_reader`
      source = await ajouterSource({ titre: 'Pilote tendances', hote: url.hostname, port: url.port || '5432', base: 'dg_support',
        utilisateur: url.username, motDePasse: decodeURIComponent(url.password), tls: 'disable' })
      jeu = await creerImport({ sourceId: source, titre: 'Série fictive', schema: 'support', table: 'tendances_fixture',
        colonnes: ['observe_le', 'montant'], description: '', frequenceMinutes: 10 })
      await synchroniserEntrepot({ jeu })
      await publierCatalogueMetier(jeu, 0, {
        description: 'Série mensuelle de recette', grain: 'Une observation par mois', cles: ['observe_le'],
        dimensions: [], colonnes: [], calendrierFiscal: { colonneDate: 'observe_le', moisDebutExercice: 1 },
        mesures: [{ cle: 'total', libelle: 'Montant mensuel', description: 'Somme des observations', colonne: 'montant', agregat: 'somme' }],
      }, acteur)
      const demande = { jeu, mesure: 'total', debut: '2026-01', fin: '2026-12', horizon: 1 }
      const utilisateur = await prisma.user.create({ data: { email: `${acteur}@example.test`, passwordHash: 'fixture', firstName: 'Recette' } })
      compte = utilisateur.id
      const lecteur = async () => ({ ...contexte, userId: utilisateur.id, roleName: 'Member', scope: (await getAccessScope(utilisateur.id))! })
      expect(await optionsTendances(await lecteur())).toContainEqual(expect.objectContaining({ cle: jeu }))
      const resultat = await analyserTendance(demande, await lecteur())
      expect(resultat.analyse.observations.filter(o => o.atypique)).toEqual([{ mois: '2026-11', valeur: 55, atypique: true }])
      expect(resultat.analyse.previsions).toMatchObject([{ mois: '2027-01', valeur: 10 }])
      expect(resultat.analyse.validation).toEqual({ mae: 5, points: 9 })
      expect(resultat.provenance.regles.some(r => r.includes('Catalogue métier v1'))).toBe(true)
      await modifierRegle(acteur, jeu, { groupes: [], masquer: [], filtre: null })
      expect(await optionsTendances(await lecteur())).not.toContainEqual(expect.objectContaining({ cle: jeu }))
      await expect(analyserTendance(demande, await lecteur())).rejects.toThrow('indisponible')
    } finally {
      if (jeu) {
        await prisma.$executeRaw`DELETE FROM warehouse.regles_acces WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.catalogue_metier WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.synchronisations WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${jeu}`
      }
      if (source) await prisma.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${source}`
      if (compte) await prisma.user.deleteMany({ where: { id: compte } })
      await prisma.$executeRaw`DELETE FROM warehouse.audit_acces WHERE acteur_id = ${acteur}`
      if (tableCreee) await support.$executeRaw`DROP TABLE support.tendances_fixture`
      await Promise.all([support.$disconnect(), prisma.$disconnect(), deconnecterPostgres()])
    }
  })
})
