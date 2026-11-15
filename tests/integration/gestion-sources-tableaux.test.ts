import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import { contexteDepuisCompte } from '@/lib/medic-assist/suivi/comptes'
import { creerCombinaison, supprimerCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { creerGroupe, modifierRegle } from '@/lib/warehouse/droits-admin'
import { enregistrerEspace } from '@/lib/warehouse/espaces'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { dechiffrerSource } from '@/lib/warehouse/secret-source'
import {
  ErreurAdministrationSource, ajouterSource, ajouterSourceFichier, creerImport, dependancesJeu, dependancesSource,
  listerTables, modifierSource, renommerImport, supprimerImport, supprimerSource, trouverSource, urlSource,
} from '@/lib/warehouse/sources-admin'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'
import { dupliquerTableau, enregistrerTableau, chargerTableau, supprimerTableau } from '@/lib/warehouse/tableaux'

const actif = process.env.DATAGENIUS_TEST_POSTGRES === '1'
const csv = (nom: string) => ({ nom, contenu: Buffer.from('produit;quantite\nPomme;4\nOrange;2\n') })

async function compter(table: string, colonne: string, cle: string) {
  const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM warehouse.${table} WHERE ${colonne} = $1`, cle)
  return n
}

describe.skipIf(!actif)('Gestion des sources, imports et jeux combinés', () => {
  const acteur = randomUUID()
  const sources: string[] = []
  const imports: string[] = []
  const combinaisons: string[] = []
  const groupes: string[] = []
  const espaces: string[] = []
  const tableaux: string[] = []
  const comptes: string[] = []

  async function importPublie(titre: string) {
    const source = await ajouterSourceFichier('Source ' + titre, csv('donnees.csv'))
    sources.push(source)
    const cle = await creerImport({ sourceId: source, schema: 'fichier', table: 'donnees', colonnes: ['produit', 'quantite'], titre, description: '', frequenceMinutes: 10 })
    imports.push(cle)
    expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'publie' }])
    return { source, cle }
  }

  afterAll(async () => {
    try {
      for (const id of tableaux) await prisma.$executeRaw`DELETE FROM warehouse.tableaux WHERE id = ${id}::uuid`
      for (const cle of combinaisons) {
        await prisma.$executeRaw`DELETE FROM warehouse.combinaisons WHERE cle = ${cle}`
        await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${cle}`
      }
      for (const jeu of imports) {
        for (const t of ['regles_acces', 'catalogue_metier', 'espaces_jeux', 'synchronisations', 'snapshots', 'executions']) {
          await prisma.$executeRawUnsafe(`DELETE FROM warehouse.${t} WHERE jeu = $1`, jeu)
        }
        await prisma.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${jeu}`
      }
      for (const id of espaces) await prisma.$executeRaw`DELETE FROM warehouse.espaces WHERE id = ${id}::uuid`
      for (const id of groupes) await prisma.$executeRaw`DELETE FROM warehouse.groupes_acces WHERE id = ${id}::uuid`
      for (const id of sources) await prisma.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${id}`
      await prisma.$executeRaw`DELETE FROM warehouse.audit_acces WHERE acteur_id = ${acteur}`
      await prisma.user.deleteMany({ where: { id: { in: comptes } } })
    } finally {
      await Promise.all([prisma.$disconnect(), deconnecterPostgres()])
    }
  })

  it('refuse de supprimer une source utilisée, puis l’accepte après suppression de l’import', async () => {
    const { source, cle } = await importPublie('Import de la source utilisée')
    expect((await dependancesSource(source)).imports).toEqual([{ cle, titre: 'Import de la source utilisée' }])
    await expect(supprimerSource(acteur, source)).rejects.toThrow('Import de la source utilisée')
    await expect(supprimerSource(acteur, source)).rejects.toBeInstanceOf(ErreurAdministrationSource)
    await supprimerImport(acteur, cle)
    await supprimerSource(acteur, source)
    expect(await trouverSource(source)).toBeNull()
    expect(await compter('source_fichiers', 'source_id', source)).toBe(0)
    expect(await compter('audit_acces', 'objet', 'Source Import de la source utilisée')).toBe(1)
    await expect(supprimerSource(acteur, source)).rejects.toThrow('introuvable')
  }, 30_000)

  it('supprime complètement un import publié et ses données liées', async () => {
    const { cle } = await importPublie('Import à purger')
    const groupe = await creerGroupe(acteur, 'Groupe purge ' + randomUUID())
    groupes.push(groupe)
    await modifierRegle(acteur, cle, { groupes: [groupe], masquer: ['quantite'], filtre: null })
    const espace = await enregistrerEspace(acteur, null, 1, { nom: 'Espace purge ' + randomUUID(), description: '', groupes: [], jeux: [cle] })
    espaces.push(espace)
    await prisma.$executeRaw`INSERT INTO warehouse.qualite_imports (jeu, version, definition) VALUES (${cle}, 1, '{}'::jsonb)`
    await prisma.$executeRaw`INSERT INTO warehouse.incremental (jeu, definition) VALUES (${cle}, '{}'::jsonb)`
    await prisma.$executeRaw`INSERT INTO warehouse.catalogue_metier (jeu, version, definition, publie_par) VALUES (${cle}, 1, '{}'::jsonb, ${acteur})`
    const tables = ['imports:cle', 'snapshots:jeu', 'synchronisations:jeu', 'executions:jeu', 'qualite_imports:jeu',
      'incremental:jeu', 'regles_acces:jeu', 'catalogue_metier:jeu', 'espaces_jeux:jeu']
    const decompte = () => Promise.all(tables.map(t => compter(t.split(':')[0], t.split(':')[1], cle)))
    expect((await decompte()).every(n => n >= 1)).toBe(true)
    expect(await dependancesJeu(cle)).toMatchObject({ droits: true, catalogue: true, qualite: true, incremental: true, espaces: [{ id: espace }] })
    const [{ revision: avant }] = await prisma.$queryRaw<{ revision: bigint }[]>`SELECT revision FROM warehouse.revision_acces WHERE id = 1`
    await supprimerImport(acteur, cle)
    expect(await decompte()).toEqual(tables.map(() => 0))
    const [{ revision: apres }] = await prisma.$queryRaw<{ revision: bigint }[]>`SELECT revision FROM warehouse.revision_acces WHERE id = 1`
    expect(apres > avant).toBe(true)
    expect(await compter('audit_acces', 'objet', 'Import à purger')).toBe(1)
    await expect(supprimerImport(acteur, cle)).rejects.toThrow('introuvable')
    await expect(supprimerImport(acteur, 'ventes')).rejects.toBeInstanceOf(ErreurAdministrationSource)
  }, 30_000)

  it('refuse de supprimer un import utilisé par un jeu combiné', async () => {
    const gauche = await importPublie('Import gauche')
    const droite = await importPublie('Import droit')
    const combinaison = await creerCombinaison({
      titre: 'Combinaison de test', description: '', gauche: gauche.cle, droite: droite.cle, type: 'interne',
      liens: [{ gauche: 'produit', droite: 'produit' }],
      colonnes: [{ cote: 'gauche', nom: 'produit' }, { cote: 'droite', nom: 'quantite' }],
    })
    combinaisons.push(combinaison)
    expect((await dependancesJeu(gauche.cle)).combinaisons).toEqual([{ cle: combinaison, titre: 'Combinaison de test' }])
    await expect(supprimerImport(acteur, gauche.cle)).rejects.toThrow('Combinaison de test')
    await expect(supprimerImport(acteur, droite.cle)).rejects.toThrow('Combinaison de test')
    expect(await compter('imports', 'cle', gauche.cle)).toBe(1)
    await supprimerCombinaison(acteur, combinaison)
    expect(await compter('combinaisons', 'cle', combinaison)).toBe(0)
    await expect(supprimerCombinaison(acteur, combinaison)).rejects.toThrow('introuvable')
    await supprimerImport(acteur, gauche.cle)
    await supprimerImport(acteur, droite.cle)
  }, 30_000)

  it('renomme un import sans changer sa copie publiée et liste ses dépendances', async () => {
    const { cle } = await importPublie('Import à renommer')
    const empreinte = async () => (await prisma.$queryRaw<{ empreinte: string }[]>`SELECT empreinte FROM warehouse.snapshots WHERE jeu = ${cle}`)[0].empreinte
    const avant = await empreinte()
    await renommerImport(acteur, cle, '  Import renommé  ')
    const [{ titre }] = await prisma.$queryRaw<{ titre: string }[]>`SELECT definition ->> 'titre' AS titre FROM warehouse.imports WHERE cle = ${cle}`
    expect(titre).toBe('Import renommé')
    expect(await empreinte()).toBe(avant)
    expect(await synchroniserEntrepot({ jeu: cle, forcer: true })).toEqual([{ jeu: cle, statut: 'identique' }])
    await expect(renommerImport(acteur, cle, '   ')).rejects.toBeInstanceOf(ErreurAdministrationSource)
    await expect(renommerImport(acteur, 'ventes', 'Autre')).rejects.toThrow('introuvable')

    const proprietaire = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, firstName: 'Dep', passwordHash: 'fixture', roleName: 'TenantAdmin' } })
    comptes.push(proprietaire.id)
    const tableau = randomUUID()
    tableaux.push(tableau)
    const tuile = (jeu: string) => ({ id: randomUUID(), type: 'mesure', jeu, mesure: 'm', dimensions: [] })
    await prisma.$executeRaw`
      INSERT INTO warehouse.tableaux (id, proprietaire_id, definition)
      VALUES (${tableau}::uuid, ${proprietaire.id}, ${JSON.stringify({ titre: 'Tableau dépendant', lecteurs: [], tuiles: [tuile(cle), tuile(cle), tuile('autre')] })}::jsonb)`
    const groupe = await creerGroupe(acteur, 'Groupe dep ' + randomUUID())
    groupes.push(groupe)
    await modifierRegle(acteur, cle, { groupes: [groupe], masquer: ['quantite'], filtre: null })
    const espace = await enregistrerEspace(acteur, null, 1, { nom: 'Espace dep ' + randomUUID(), description: '', groupes: [], jeux: [cle] })
    espaces.push(espace)
    const dependances = await dependancesJeu(cle)
    expect(dependances).toMatchObject({
      combinaisons: [], tableaux: [{ id: tableau, titre: 'Tableau dépendant' }], espaces: [{ id: espace }],
      droits: true, catalogue: false, qualite: false, incremental: false,
    })
    await supprimerImport(acteur, cle)
    // Les tuiles ne sont pas modifiées : elles s'afficheront comme indisponibles.
    expect((await dependancesJeu(cle)).tableaux).toHaveLength(1)
  }, 30_000)

  it.skipIf(!process.env.DATAGENIUS_SOURCE_DISTRIBUTION)('modifie une connexion PostgreSQL : mot de passe conservé, test préalable, rien en cas d’échec', async () => {
    const url = new URL(process.env.DATAGENIUS_SOURCE_DISTRIBUTION!)
    const saisie = {
      titre: 'Connexion à modifier', hote: url.hostname, port: url.port || '5432', base: url.pathname.slice(1),
      utilisateur: decodeURIComponent(url.username), motDePasse: decodeURIComponent(url.password), tls: 'disable',
    }
    const id = await ajouterSource(saisie)
    sources.push(id)
    const secret = async () => (await prisma.$queryRaw<{ secret: string }[]>`SELECT secret FROM warehouse.sources WHERE id = ${id}`)[0].secret
    const initial = await secret()
    await modifierSource(id, { ...saisie, titre: 'Connexion renommée', hote: '127.0.0.1', port: url.port || '5432', motDePasse: '' })
    expect(await trouverSource(id)).toMatchObject({ titre: 'Connexion renommée', hote: '127.0.0.1:' + (url.port || '5432') })
    expect((await listerTables(id)).tables.length).toBeGreaterThan(0)
    expect(dechiffrerSource(id, await secret())).toContain(url.password)
    expect(await urlSource(id)).toContain(url.password)
    const avant = await secret()
    expect(avant).not.toBe(initial)
    await expect(modifierSource(id, { ...saisie, titre: 'Ne doit pas passer', motDePasse: 'mauvais-mot-de-passe' }))
      .rejects.toThrow('Rien n’a été modifié')
    expect(await secret()).toBe(avant)
    expect((await trouverSource(id))?.titre).toBe('Connexion renommée')
    // Changer la destination exige de ressaisir le mot de passe : il n'est jamais réutilisé vers une autre cible.
    for (const [champ, valeur] of [['hote', 'localhost'], ['port', '1'], ['base', 'autre_base'], ['utilisateur', 'autre_compte']]) {
      await expect(modifierSource(id, { ...saisie, [champ]: valeur, motDePasse: '' })).rejects.toThrow('Ressaisissez')
    }
    expect(await secret()).toBe(avant)
    await expect(modifierSource(id, { ...saisie, inconnu: 'x' })).rejects.toBeInstanceOf(ErreurAdministrationSource)
    await expect(modifierSource(id, { titre: 'Fichier seul' })).rejects.toBeInstanceOf(ErreurAdministrationSource)
  }, 30_000)

  it('supprime et duplique les tableaux selon les droits', async () => {
    async function creerCompte(roleName: string) {
      const compte = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, firstName: 'Gestion', passwordHash: 'fixture', roleName } })
      comptes.push(compte.id)
      const contexte = await contexteDepuisCompte(compte.id)
      if (!contexte) throw new Error('Compte de test inaccessible')
      return contexte
    }
    const proprietaire = await creerCompte('TenantAdmin')
    const lecteur = await creerCompte('Member')
    const admin = await creerCompte('TenantAdmin')
    const definition = { titre: 'T'.repeat(120), lecteurs: [lecteur.userId], tuiles: [] }
    const creer = async () => { const id = await enregistrerTableau(proprietaire, definition); tableaux.push(id); return id }

    const id = await creer()
    expect(await compter('lecteurs_tableaux', 'tableau_id::text', id)).toBe(1)
    await expect(supprimerTableau(lecteur, id)).rejects.toThrow('Tableau indisponible.')
    await expect(dupliquerTableau(lecteur, id)).rejects.toThrow('Tableau indisponible.')
    await expect(dupliquerTableau(admin, id)).rejects.toThrow('Tableau indisponible.')
    await expect(supprimerTableau(lecteur, 'pas-un-uuid')).rejects.toThrow('Tableau indisponible.')

    const copie = await dupliquerTableau(proprietaire, id)
    tableaux.push(copie)
    expect(copie).not.toBe(id)
    const dupliquee = await chargerTableau(copie, proprietaire)
    expect(dupliquee?.definition.titre).toBe(('Copie de ' + definition.titre).slice(0, 120))
    expect(dupliquee?.definition.lecteurs).toEqual([])
    expect(await compter('lecteurs_tableaux', 'tableau_id::text', copie)).toBe(0)
    expect(await chargerTableau(copie, lecteur)).toBeNull()
    const [{ proprietaire_id: possesseur }] = await prisma.$queryRaw<{ proprietaire_id: string }[]>`SELECT proprietaire_id FROM warehouse.tableaux WHERE id = ${copie}::uuid`
    expect(possesseur).toBe(proprietaire.userId)

    await supprimerTableau(proprietaire, id)
    expect(await compter('tableaux', 'id::text', id)).toBe(0)
    expect(await compter('lecteurs_tableaux', 'tableau_id::text', id)).toBe(0)
    await expect(supprimerTableau(proprietaire, id)).rejects.toThrow('Tableau indisponible.')

    // Un TenantAdmin non propriétaire peut supprimer, sans être lecteur.
    await supprimerTableau(admin, copie)
    expect(await compter('tableaux', 'id::text', copie)).toBe(0)
  }, 30_000)
})
