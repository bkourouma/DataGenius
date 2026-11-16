import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { getAccessScope } from '@/lib/auth/access-scope'
import { prisma } from '@/lib/db/client'
import { enregistrerComplementGlossaire } from '@/lib/glossaire/complement'
import { listerGlossaire } from '@/lib/glossaire/glossaire'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { rechercher, type ResultatRecherche } from '@/lib/recherche/rechercher'
import { publierCatalogueMetier } from '@/lib/warehouse/catalogue-metier'
import { creerGroupe, modifierGroupe, modifierRegle } from '@/lib/warehouse/droits-admin'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { ajouterSource, creerImport } from '@/lib/warehouse/sources-admin'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'

async function code(promesse: Promise<unknown>) {
  try {
    await promesse
  } catch (erreur) {
    return (erreur as { code?: string }).code ?? 'autre'
  }
  return 'aucune'
}

const ids = (resultats: ResultatRecherche[], type: ResultatRecherche['type']) =>
  resultats.filter(r => r.type === type).map(r => r.id)

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Glossaire et recherche globale', () => {
  afterAll(async () => Promise.all([prisma.$disconnect(), deconnecterPostgres()]))

  it('respecte les droits des jeux, la visibilité des analyses, tableaux et sources, et les compléments admin', async () => {
    const url = new URL(process.env.DATAGENIUS_SOURCE_DISTRIBUTION ?? '')
    if (url.pathname !== '/dg_source' || new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') {
      throw new Error('Utiliser uniquement les bases de recette PostgreSQL.')
    }
    // Jeton unique : les recherches ne retrouvent que les objets de ce test.
    const jeton = `z${randomUUID().replaceAll('-', '')}`
    const titreSource = `Recette glossaire ${jeton}`
    const nomGroupe = `Recette glossaire ${randomUUID()}`
    const acteur = randomUUID()
    const users: string[] = []
    const tableaux: string[] = []
    let groupe: string | undefined
    let jeu: string | undefined
    let source: string | undefined
    async function creerCompte(roleName = 'Member') {
      const compte = await prisma.user.create({
        data: { email: `${randomUUID()}@example.test`, firstName: 'Recette', roleName, passwordHash: 'fixture' },
      })
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
      const tiers = await creerCompte()
      const admin = await creerCompte('TenantAdmin')

      source = await ajouterSource({ titre: titreSource, hote: url.hostname, port: url.port || '5432',
        base: 'dg_source', utilisateur: url.username, motDePasse: decodeURIComponent(url.password), tls: 'disable' })
      jeu = await creerImport({ sourceId: source, schema: 'metier', table: 'activite', titre: `Jeu glossaire ${jeton}`,
        description: 'Recette du glossaire', colonnes: ['agence', 'mois', 'ca'], frequenceMinutes: 10 })
      const cleJeu = jeu
      await synchroniserEntrepot({ jeu: cleJeu })
      await publierCatalogueMetier(cleJeu, 0, { description: 'Activité test', grain: 'Ligne source', cles: [],
        dimensions: ['agence'], colonnes: [], mesures: [
          { cle: 'total', libelle: `Chiffre d’affaires généré ${jeton}`, description: 'Somme du chiffre d’affaires', colonne: 'ca', agregat: 'somme', unite: 'EUR' },
          { cle: 'nb_mois', libelle: `Mois comptés ${jeton}`, description: 'Nombre de mois', colonne: 'mois', agregat: 'nombre' },
        ] }, admin)

      groupe = await creerGroupe(acteur, nomGroupe)
      await modifierGroupe(acteur, groupe, nomGroupe, [admis])
      await modifierRegle(acteur, cleJeu, { groupes: [groupe], masquer: ['mois'], filtre: null })

      const cAdmis = await contexte(admis)
      const cExclu = await contexte(exclu)
      const cTiers = await contexte(tiers)
      const cAdmin = await contexte(admin)
      const dansLeJeu = async (ctx: ContexteExecution, recherche?: string) =>
        (await listerGlossaire(ctx, { recherche })).filter(e => e.jeu.cle === cleJeu)

      // Glossaire : exclu = rien ; admis = sans l'indicateur qui dépend de la colonne masquée ; admin = tout.
      expect(await dansLeJeu(cExclu)).toEqual([])
      const visibles = await dansLeJeu(cAdmis)
      expect(visibles.map(e => e.indicateur.cle)).toEqual(['total'])
      expect(JSON.stringify(visibles)).not.toContain('mois')
      expect(visibles[0]).toMatchObject({ unite: 'EUR', formule: { agregat: 'somme', colonne: 'ca', regles: [] } })
      expect((await dansLeJeu(cAdmin)).map(e => e.indicateur.cle).sort()).toEqual(['nb_mois', 'total'])

      // Recherche : mêmes cloisons, insensible à la casse et aux accents.
      expect(ids(await rechercher(cExclu, jeton), 'glossaire')).toEqual([])
      expect(ids(await rechercher(cAdmis, jeton), 'glossaire')).toEqual([`${cleJeu}-total`])
      expect(ids(await rechercher(cAdmin, jeton), 'glossaire').sort()).toEqual([`${cleJeu}-nb_mois`, `${cleJeu}-total`])
      expect(ids(await rechercher(cAdmis, `CHIFFRE D’AFFAIRES GENERE ${jeton.toUpperCase()}`), 'glossaire')).toEqual([`${cleJeu}-total`])
      expect(await rechercher(cAdmis, 'x')).toEqual([])

      // Tableaux : propriétaire ou lecteur seulement, titre insensible aux accents.
      const tableau = randomUUID()
      tableaux.push(tableau)
      await prisma.$executeRaw`
        INSERT INTO warehouse.tableaux (id, proprietaire_id, definition)
        VALUES (${tableau}::uuid, ${tiers}, ${JSON.stringify({ titre: `Tableau Éléphant ${jeton}` })}::jsonb)`
      expect(ids(await rechercher(cTiers, `eLEPHANT ${jeton}`), 'tableau')).toEqual([tableau])
      expect(ids(await rechercher(cAdmis, `eLEPHANT ${jeton}`), 'tableau')).toEqual([])
      await prisma.$executeRaw`INSERT INTO warehouse.lecteurs_tableaux (tableau_id, utilisateur_id) VALUES (${tableau}::uuid, ${admis})`
      expect(ids(await rechercher(cAdmis, `eLEPHANT ${jeton}`), 'tableau')).toEqual([tableau])
      expect(ids(await rechercher(cExclu, `eLEPHANT ${jeton}`), 'tableau')).toEqual([])

      // Analyses : l'artefact d'un tiers n'apparaît qu'une fois partagé ; aucune conversation.
      const racine = randomUUID()
      await prisma.assistantArtefact.create({
        data: { id: racine, racineId: racine, userId: tiers, type: 'tableau', titre: `Analyse déjà partagée ${jeton}`,
          description: 'Note de recette', spec: {}, jeuxDeDonneesIds: [], enregistre: true, enregistreA: new Date() },
      })
      expect(ids(await rechercher(cTiers, `DEJA PARTAGEE ${jeton}`), 'analyse')).toEqual([racine])
      expect(ids(await rechercher(cAdmis, jeton), 'analyse')).toEqual([])
      await prisma.assistantPartage.create({
        data: { ressourceType: 'artefact', ressourceId: racine, deUserId: tiers, aUserId: admis },
      })
      const apresPartage = await rechercher(cAdmis, `deja partagee ${jeton}`)
      expect(apresPartage.filter(r => r.type === 'analyse')).toEqual([
        expect.objectContaining({ id: racine, href: `/assistant/analyses/${racine}`, detail: 'Note de recette' }),
      ])
      expect(ids(await rechercher(cExclu, jeton), 'analyse')).toEqual([])
      // Un artefact non enregistré de son propriétaire n'est pas dans « Analyses ».
      const brouillon = randomUUID()
      await prisma.assistantArtefact.create({
        data: { id: brouillon, racineId: brouillon, userId: tiers, type: 'tableau', titre: `Brouillon ${jeton}`, spec: {}, jeuxDeDonneesIds: [] },
      })
      expect(ids(await rechercher(cTiers, `brouillon ${jeton}`), 'analyse')).toEqual([])

      // Sources : réservées au TenantAdmin.
      expect(ids(await rechercher(cAdmin, `RECETTE GLOSSAIRE ${jeton}`), 'source')).toEqual([source])
      expect(ids(await rechercher(cAdmis, `recette glossaire ${jeton}`), 'source')).toEqual([])
      expect(ids(await rechercher(cTiers, jeton), 'source')).toEqual([])

      // Compléments : refusé à un Member, enregistré par un admin, relu par tous, retrouvé par synonyme.
      const synonyme = `Turnover ${jeton}`
      expect(await code(enregistrerComplementGlossaire(cAdmis, { jeu: cleJeu, indicateur: 'total', definition: 'Pirate', synonymes: [] }))).toBe('interdit')
      expect(await code(enregistrerComplementGlossaire(cAdmin, { jeu: cleJeu, indicateur: 'inconnu', definition: 'x', synonymes: [] }))).toBe('introuvable')
      expect(await code(enregistrerComplementGlossaire(cAdmin, { jeu: cleJeu, indicateur: 'total', definition: 'x'.repeat(601), synonymes: [] }))).toBe('invalide')
      expect((await dansLeJeu(cAdmis))[0]?.definition).toBe('Somme du chiffre d’affaires')
      await enregistrerComplementGlossaire(cAdmin, {
        jeu: cleJeu, indicateur: 'total', definition: '  Définition maison  ', synonymes: [synonyme, synonyme.toUpperCase(), 'Recettes'],
      })
      const lu = (await dansLeJeu(cAdmis))[0]!
      expect(lu).toMatchObject({ definition: 'Définition maison', synonymes: [synonyme, 'Recettes'] })
      expect((await dansLeJeu(cAdmis, synonyme.toUpperCase())).map(e => e.indicateur.cle)).toEqual(['total'])
      expect(ids(await rechercher(cAdmis, synonyme.toLowerCase()), 'glossaire')).toEqual([`${cleJeu}-total`])
      expect(ids(await rechercher(cExclu, synonyme), 'glossaire')).toEqual([])
      const [ligne] = await prisma.$queryRaw<{ modifie_par: string }[]>`SELECT modifie_par FROM warehouse.glossaire WHERE jeu = ${cleJeu} AND indicateur = 'total'`
      expect(ligne?.modifie_par).toBe(admin)
      // Mise à jour puis suppression par vidage complet.
      await enregistrerComplementGlossaire(cAdmin, { jeu: cleJeu, indicateur: 'total', definition: '', synonymes: [] })
      expect(await prisma.$queryRaw`SELECT 1 FROM warehouse.glossaire WHERE jeu = ${cleJeu}`).toEqual([])
      expect((await dansLeJeu(cAdmis))[0]?.definition).toBe('Somme du chiffre d’affaires')
    } finally {
      if (jeu) await prisma.$executeRaw`DELETE FROM warehouse.glossaire WHERE jeu = ${jeu}`
      if (tableaux.length) await prisma.$executeRaw`DELETE FROM warehouse.tableaux WHERE id = ANY(${tableaux}::uuid[])`
      await prisma.assistantArtefact.deleteMany({ where: { userId: { in: users } } })
      await prisma.assistantPartage.deleteMany({ where: { OR: [{ deUserId: { in: users } }, { aUserId: { in: users } }] } })
      if (jeu) await prisma.$executeRaw`DELETE FROM warehouse.regles_acces WHERE jeu = ${jeu}`
      if (groupe) await prisma.$executeRaw`DELETE FROM warehouse.groupes_acces WHERE id = ${groupe}::uuid`
      await prisma.$executeRaw`DELETE FROM warehouse.audit_acces WHERE acteur_id = ${acteur}`
      await prisma.user.deleteMany({ where: { id: { in: users } } })
      if (jeu) {
        await prisma.$executeRaw`DELETE FROM warehouse.catalogue_metier WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.synchronisations WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${jeu}`
        await prisma.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${jeu}`
      }
      if (source) await prisma.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${source}`
    }
  }, 60_000)
})
