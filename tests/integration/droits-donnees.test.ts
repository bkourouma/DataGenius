import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { getAccessScope } from '@/lib/auth/access-scope'
import { prisma } from '@/lib/db/client'
import { construireExport } from '@/lib/medic-assist/artefacts/exports'
import { creerArtefact } from '@/lib/medic-assist/artefacts/stockage'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { calculerSql } from '@/lib/medic-assist/donnees/sql/calcul'
import { interrogerDonnees, lireJeu, resumeCatalogueCompact } from '@/lib/medic-assist/donnees/outils'
import { creerCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { publierCatalogueMetier } from '@/lib/warehouse/catalogue-metier'
import { configurationDroits, creerGroupe, modifierGroupe, modifierRegle } from '@/lib/warehouse/droits-admin'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { ajouterSource, creerImport } from '@/lib/warehouse/sources-admin'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Droits des jeux publiés', () => {
  afterAll(async () => Promise.all([prisma.$disconnect(), deconnecterPostgres()]))

  it('isole les groupes, filtre et masque les colonnes jusqu’à l’export, puis révoque le cache', async () => {
    const url = new URL(process.env.DATAGENIUS_SOURCE_DISTRIBUTION ?? '')
    if (url.pathname !== '/dg_source' || new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') {
      throw new Error('Utiliser uniquement les bases de recette PostgreSQL.')
    }
    const source = await ajouterSource({ titre: 'Recette droits', hote: url.hostname, port: url.port || '5432',
      base: 'dg_source', utilisateur: url.username, motDePasse: decodeURIComponent(url.password), tls: 'disable' })
    const jeu = await creerImport({ sourceId: source, schema: 'metier', table: 'activite', titre: 'Jeu protégé',
      description: 'Recette de cloisonnement', colonnes: ['agence', 'mois', 'ca'], frequenceMinutes: 10 })
    const nomGroupe = `Recette droits ${randomUUID()}`
    const acteur = randomUUID()
    let groupe: string | undefined
    const users: string[] = []
    let combinaison: string | undefined
    async function creerCompte() {
      const compte = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, firstName: 'Recette', passwordHash: 'fixture' } })
      users.push(compte.id)
      return compte.id
    }
    async function contexte(userId: string): Promise<ContexteExecution> {
      const scope = await getAccessScope(userId)
      if (!scope) throw new Error('Compte indisponible')
      return { userId, roleName: scope.roleName, scope, habilitations: null, locale: 'fr', maintenant: new Date() }
    }
    try {
      const admis = await creerCompte()
      const exclu = await creerCompte()
      groupe = await creerGroupe(acteur, nomGroupe)
      await synchroniserEntrepot({ jeu })
      await synchroniserEntrepot({ jeu: 'centres' })
      combinaison = await creerCombinaison({ titre: 'Dérivé privé', description: '', gauche: jeu, droite: 'centres',
        type: 'gauche', liens: [{ gauche: 'agence', droite: 'centre' }], colonnes: [{ cote: 'gauche', nom: 'ca' }] })
      await publierCatalogueMetier(jeu, 0, { description: 'Ventes test', grain: 'Ligne source', cles: [],
        dimensions: ['agence', 'mois'], colonnes: [], mesures: [{ cle: 'total', libelle: 'Total', description: 'Somme',
          colonne: 'ca', agregat: 'somme' }] }, admis)
      const regle = { groupes: [groupe], masquer: ['mois'], filtre: { colonne: 'agence', valeur: 'Lagune' } }
      await modifierGroupe(acteur, groupe, nomGroupe, [admis])
      await modifierRegle(acteur, jeu, regle)
      expect((await configurationDroits()).audit).toContainEqual(expect.objectContaining({ action: 'Accès restreint', objet: jeu }))
      const autorise = await contexte(admis)
      const refuse = await contexte(exclu)
      expect(await resumeCatalogueCompact(refuse)).not.toContain(jeu)
      expect(await resumeCatalogueCompact(autorise)).not.toContain(combinaison)
      const sql = await calculerSql({ objectif: 'Ventes visibles', sql: `SELECT DISTINCT agence FROM mv_${jeu}` }, autorise)
      expect(sql.lignes).toEqual([{ agence: 'Lagune' }])
      await expect(calculerSql({ objectif: 'Colonne masquée', sql: `SELECT mois FROM mv_${jeu}` }, autorise)).rejects.toBeDefined()
      await expect(calculerSql({ objectif: 'Jeu non autorisé', sql: `SELECT agence FROM mv_${jeu}` }, refuse)).rejects.toBeDefined()
      const resultat = await interrogerDonnees(autorise, { jeu, mesures: ['total'], dimensions: ['agence'] })
      const artefact = await creerArtefact(autorise, {
        spec: { type: 'tableau', titre: 'Total autorisé', jeuDeDonneesId: resultat.jeuDeDonneesId },
      })
      const csv = await construireExport(autorise, artefact.artefactId, 'csv')
      expect(csv.buffer.toString('utf8')).toMatch(/Lagune[\s\S]*2080/)
      expect(csv.buffer.toString('utf8')).not.toContain('Plateau')
      await expect(construireExport(refuse, artefact.artefactId, 'csv')).rejects.toMatchObject({ code: 'introuvable' })
      await modifierGroupe(acteur, groupe, nomGroupe, [])
      const revoque = await contexte(admis)
      await expect(lireJeu(resultat.jeuDeDonneesId, revoque)).rejects.toBeDefined()
      await expect(construireExport(revoque, artefact.artefactId, 'csv')).rejects.toMatchObject({ code: 'introuvable' })
    } finally {
      await prisma.$executeRaw`DELETE FROM warehouse.regles_acces WHERE jeu = ${jeu}`
      if (groupe) await prisma.$executeRaw`DELETE FROM warehouse.groupes_acces WHERE id = ${groupe}::uuid`
      await prisma.$executeRaw`DELETE FROM warehouse.audit_acces WHERE acteur_id = ${acteur}`
      await prisma.user.deleteMany({ where: { id: { in: users } } })
      await prisma.$executeRaw`DELETE FROM warehouse.catalogue_metier WHERE jeu = ${jeu}`
      if (combinaison) await prisma.$executeRaw`DELETE FROM warehouse.combinaisons WHERE cle = ${combinaison}`
      await prisma.$executeRaw`DELETE FROM warehouse.synchronisations WHERE jeu = ${jeu}`
      await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${jeu}`
      await prisma.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${jeu}`
      await prisma.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${source}`
    }
  }, 30_000)
})
