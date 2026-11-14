import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db/client'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { ajouterSource, creerImport } from '@/lib/warehouse/sources-admin'
import { etatEntrepot, purgerExecutions, purgerExecutionsSiEchu, synchroniserEntrepot } from '@/lib/warehouse/synchronisation'

type Etat = { echecs_consecutifs: number; prochain_essai_a: Date | null; delai_s: number | null }

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Fiabilité de la synchronisation PostgreSQL', () => {
  let url: URL
  let redacteur: PrismaClient
  // Objets créés par les tests, nettoyés après chacun.
  const sources: string[] = []
  const jeux: string[] = []
  const objetsSupport: string[] = []
  const triggers: { nom: string; fonction: string }[] = []

  const suffixe = () => randomUUID().replaceAll('-', '').slice(0, 12)

  beforeAll(() => {
    url = new URL(process.env.DATAGENIUS_SOURCE_SUPPORT ?? '')
    const urlEcriture = new URL(process.env.DATAGENIUS_TEST_SUPPORT_OWNER_URL ?? '')
    if ([url.pathname, urlEcriture.pathname].some(base => base !== '/dg_support') ||
        new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') {
      throw new Error('Utiliser les bases fictives de la recette.')
    }
    redacteur = new PrismaClient({ datasourceUrl: urlEcriture.href })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const { nom, fonction } of triggers.splice(0)) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${nom} ON warehouse.snapshots`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.${fonction}()`)
    }
    for (const jeu of jeux.splice(0)) {
      await prisma.$executeRaw`DELETE FROM warehouse.verrous_synchronisation WHERE jeu = ${jeu}`
      await prisma.$executeRaw`DELETE FROM warehouse.executions WHERE jeu = ${jeu}`
      await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${jeu}`
      await prisma.$executeRaw`DELETE FROM warehouse.synchronisations WHERE jeu = ${jeu}`
      await prisma.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${jeu}`
    }
    for (const source of sources.splice(0)) await prisma.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${source}`
    for (const objet of objetsSupport.splice(0).reverse()) await redacteur.$executeRawUnsafe(`DROP ${objet}`)
  })

  afterAll(async () => {
    await redacteur?.$disconnect()
    await Promise.all([prisma.$disconnect(), deconnecterPostgres()])
  })

  // Crée une table source (id, valeur) lisible par le jeu.
  async function creerTable(nom: string, lignes = 3) {
    await redacteur.$executeRawUnsafe(`CREATE TABLE support.${nom} (id int NOT NULL, valeur text)`)
    objetsSupport.push(`TABLE IF EXISTS support.${nom}`)
    await redacteur.$executeRawUnsafe(`GRANT SELECT ON support.${nom} TO dg_support_reader`)
    await redacteur.$executeRawUnsafe(`INSERT INTO support.${nom} SELECT i, 'v' || i FROM generate_series(1, ${lignes}) AS i`)
  }

  async function creerSource() {
    const id = await ajouterSource({ titre: 'Source fiabilité ' + suffixe(), hote: url.hostname, port: url.port || '5432',
      base: 'dg_support', utilisateur: url.username, motDePasse: decodeURIComponent(url.password), tls: 'disable' })
    sources.push(id)
    return id
  }

  async function creerJeu(sourceId: string, titre: string, table: string, frequenceMinutes = 60) {
    const cle = await creerImport({ sourceId, titre, schema: 'support', table, colonnes: ['id', 'valeur'],
      description: '', frequenceMinutes })
    jeux.push(cle)
    return cle
  }

  const snapshots = async (jeu: string) => (await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM warehouse.snapshots WHERE jeu = ${jeu}`)[0].n
  const executions = async (jeu: string) => prisma.$queryRaw<{ statut: string; code: string | null }[]>`
    SELECT statut, code FROM warehouse.executions WHERE jeu = ${jeu} ORDER BY id`
  const baux = async (...cles: string[]) => (await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM warehouse.verrous_synchronisation WHERE jeu IN (${Prisma.join(cles)})`)[0].n
  const etat = async (jeu: string) => (await prisma.$queryRaw<Etat[]>`
    SELECT echecs_consecutifs, prochain_essai_a,
      extract(epoch FROM prochain_essai_a - verifie_a)::float AS delai_s
    FROM warehouse.synchronisations WHERE jeu = ${jeu}`)[0]

  it('isole l\'exception d\'un jeu : échec interne enregistré, le jeu suivant est publié, bails libérés', async () => {
    const espion = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const sourceId = await creerSource()
    const tableA = 'fiab_a_' + suffixe()
    const tableB = 'fiab_b_' + suffixe()
    await creerTable(tableA)
    await creerTable(tableB)
    // L'ordre de traitement suit la clé triée : les préfixes de titre « aaa » et « zzz » fixent A avant B.
    const a = await creerJeu(sourceId, 'Aaa isolation ' + suffixe(), tableA)
    const b = await creerJeu(sourceId, 'Zzz isolation ' + suffixe(), tableB)
    expect(a < b).toBe(true)

    const fonction = 'fiab_leve_' + suffixe()
    const declencheur = 'fiab_trg_' + suffixe()
    await prisma.$executeRawUnsafe(`CREATE FUNCTION public.${fonction}() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'panne simulee secrete'; END $$`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${declencheur} BEFORE INSERT ON warehouse.snapshots
      FOR EACH ROW WHEN (NEW.jeu = '${a}') EXECUTE FUNCTION public.${fonction}()`)
    triggers.push({ nom: declencheur, fonction })

    const resultats = (await synchroniserEntrepot()).filter(r => [a, b].includes(r.jeu))
    expect(resultats).toEqual([{ jeu: a, statut: 'echec', code: 'interne' }, { jeu: b, statut: 'publie' }])
    expect(await snapshots(a)).toBe(0)
    expect(await snapshots(b)).toBe(1)
    expect(await executions(a)).toEqual([{ statut: 'echec', code: 'interne' }])
    const etatA = await etat(a)
    expect(etatA.echecs_consecutifs).toBe(1)
    expect(etatA.prochain_essai_a!.getTime()).toBeGreaterThan(Date.now())
    expect(await baux(a, b)).toBe(0)

    const appels = espion.mock.calls
      .map(appel => JSON.parse(appel[0] as string) as Record<string, unknown>)
      .filter(ligne => ligne.domaine === 'synchronisation')
    expect(appels.length).toBeGreaterThanOrEqual(1)
    expect(appels[0]).toEqual(expect.objectContaining({ jeu: a, code: 'interne' }))
    const journal = JSON.stringify(appels)
    expect(journal).not.toContain('panne simulee secrete')
    expect(journal).not.toContain('postgresql://')
  }, 60_000)

  it('applique le backoff exponentiel plafonné par la fréquence, puis se rétablit', async () => {
    const sourceId = await creerSource()
    const table = 'fiab_backoff_' + suffixe()
    await creerTable(table)
    const cle = await creerJeu(sourceId, 'Backoff ' + suffixe(), table, 60)
    // Source devenue inaccessible après la création du jeu : la lecture échoue (code 'schema').
    await redacteur.$executeRawUnsafe(`ALTER TABLE support.${table} RENAME TO ${table}_absente`)
    objetsSupport.push(`TABLE IF EXISTS support.${table}_absente`)

    expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'echec', code: 'schema' }])
    let courant = await etat(cle)
    expect(courant.echecs_consecutifs).toBe(1)
    expect(courant.delai_s).toBeGreaterThan(110)
    expect(courant.delai_s).toBeLessThan(130)
    expect(await executions(cle)).toEqual([{ statut: 'echec', code: 'schema' }])

    // Immédiatement après : le jeu n'est pas retenté.
    expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'pas_echu', code: 'backoff' }])
    expect(await executions(cle)).toHaveLength(1)

    // Une synchronisation forcée retente et double le délai.
    expect(await synchroniserEntrepot({ jeu: cle, forcer: true })).toEqual([{ jeu: cle, statut: 'echec', code: 'schema' }])
    courant = await etat(cle)
    expect(courant.echecs_consecutifs).toBe(2)
    expect(courant.delai_s).toBeGreaterThan(230)
    expect(courant.delai_s).toBeLessThan(250)
    expect(await executions(cle)).toHaveLength(2)

    // etatEntrepot expose le compteur et la prochaine tentative.
    const fiche = (await etatEntrepot()).find(e => e.cle === cle)
    expect(fiche?.etat?.echecs_consecutifs).toBe(2)
    expect(fiche?.etat?.prochain_essai_a).toBeInstanceOf(Date)

    // Source réparée, délai échu : la synchronisation sans forcer republie et remet le compteur à zéro.
    await redacteur.$executeRawUnsafe(`ALTER TABLE support.${table}_absente RENAME TO ${table}`)
    await prisma.$executeRaw`UPDATE warehouse.synchronisations
      SET prochain_essai_a = now() - interval '1 minute', verifie_a = now() - interval '2 hours' WHERE jeu = ${cle}`
    expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'publie' }])
    courant = await etat(cle)
    expect(courant.echecs_consecutifs).toBe(0)
    expect(courant.prochain_essai_a).toBeNull()
  }, 60_000)

  it('plafonne le délai de backoff à la fréquence du jeu', async () => {
    const sourceId = await creerSource()
    const table = 'fiab_plafond_' + suffixe()
    await creerTable(table)
    const cle = await creerJeu(sourceId, 'Plafond ' + suffixe(), table, 1)
    await redacteur.$executeRawUnsafe(`ALTER TABLE support.${table} RENAME TO ${table}_absente`)
    objetsSupport.push(`TABLE IF EXISTS support.${table}_absente`)
    expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'echec', code: 'schema' }])
    const courant = await etat(cle)
    expect(courant.delai_s).toBeGreaterThan(50)
    expect(courant.delai_s).toBeLessThan(70)
    await synchroniserEntrepot({ jeu: cle, forcer: true })
    const second = await etat(cle)
    expect(second.echecs_consecutifs).toBe(2)
    expect(second.delai_s).toBeLessThan(70)
  }, 60_000)

  it('retente un jeu en échec dès que prochain_essai_a est échu, même avant la fréquence du jeu', async () => {
    const sourceId = await creerSource()
    const table = 'fiab_reprise_' + suffixe()
    await creerTable(table)
    const cle = await creerJeu(sourceId, 'Reprise ' + suffixe(), table, 60)
    await redacteur.$executeRawUnsafe(`ALTER TABLE support.${table} RENAME TO ${table}_absente`)
    objetsSupport.push(`TABLE IF EXISTS support.${table}_absente`)
    expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'echec', code: 'schema' }])
    await redacteur.$executeRawUnsafe(`ALTER TABLE support.${table}_absente RENAME TO ${table}`)
    await prisma.$executeRaw`UPDATE warehouse.synchronisations SET prochain_essai_a = now() - interval '1 minute' WHERE jeu = ${cle}`
    expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'publie' }])
  }, 60_000)

  it('purge uniquement les exécutions à la fois anciennes et au-delà des plus récentes du jeu', async () => {
    const [p1, p2, p3] = [1, 2, 3].map(() => 'fiab_purge_' + suffixe())
    jeux.push(p1, p2, p3)
    const inserer = (jeu: string, joursPasses: number) => prisma.$executeRaw`
      INSERT INTO warehouse.executions (jeu, empreinte, qualite_version, verifie_a, duree_ms, statut, lignes_lues, lignes_valides, code)
      VALUES (${jeu}, 'e', 0, clock_timestamp() - ${joursPasses}::int * interval '1 day', 1, 'publie', 1, 1, NULL)`
    // p1 : 3 récentes + 6 anciennes (rangs 4 et 5 anciens conservés, rangs 6 à 9 supprimés).
    for (const j of [1, 2, 3, 100, 101, 102, 103, 104, 105]) await inserer(p1, j)
    // p2 : 7 récentes (aucune suppression malgré le rang > 5).
    for (const j of [1, 2, 3, 4, 5, 6, 7]) await inserer(p2, j)
    // p3 : 7 anciennes (les 2 plus vieilles sont supprimées).
    for (const j of [95, 96, 97, 98, 99, 100, 101]) await inserer(p3, j)

    const supprimees = await purgerExecutions(90, 5)
    expect(supprimees).toBeGreaterThanOrEqual(6)
    const reste = async (jeu: string) => (await prisma.$queryRaw<{ jours: number }[]>`
      SELECT round(extract(epoch FROM clock_timestamp() - verifie_a) / 86400)::int AS jours
      FROM warehouse.executions WHERE jeu = ${jeu} ORDER BY verifie_a DESC`).map(l => l.jours)
    expect(await reste(p1)).toEqual([1, 2, 3, 100, 101])
    expect(await reste(p2)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(await reste(p3)).toEqual([95, 96, 97, 98, 99])

    // Une seconde purge ne supprime plus rien de ces jeux.
    await purgerExecutions(90, 5)
    expect(await reste(p1)).toHaveLength(5)

    // Le déclencheur horaire n'exécute la purge qu'une fois par intervalle.
    const maintenant = Date.now()
    expect(await purgerExecutionsSiEchu(maintenant, 3_600_000)).toEqual(expect.any(Number))
    expect(await purgerExecutionsSiEchu(maintenant + 1, 3_600_000)).toBeNull()
    expect(await purgerExecutionsSiEchu(maintenant + 3_600_001, 3_600_000)).toEqual(expect.any(Number))
  }, 60_000)

  it('refuse deux synchronisations concurrentes du même jeu, puis reprend un bail périmé', async () => {
    const sourceId = await creerSource()
    const table = 'fiab_conc_' + suffixe()
    const vue = table + '_lente'
    await creerTable(table)
    await redacteur.$executeRawUnsafe(`CREATE VIEW support.${vue} AS SELECT t.id, t.valeur FROM support.${table} t, pg_sleep(1.5)`)
    objetsSupport.push(`VIEW IF EXISTS support.${vue}`)
    await redacteur.$executeRawUnsafe(`GRANT SELECT ON support.${vue} TO dg_support_reader`)
    const cle = await creerJeu(sourceId, 'Concurrence ' + suffixe(), vue)

    const resultats = await Promise.all([
      synchroniserEntrepot({ jeu: cle, forcer: true }),
      synchroniserEntrepot({ jeu: cle, forcer: true }),
    ])
    const statuts = resultats.map(r => r[0].statut).sort()
    expect(statuts).toEqual(['en_cours', 'publie'])
    expect(await snapshots(cle)).toBe(1)
    expect(await executions(cle)).toEqual([{ statut: 'publie', code: null }])
    expect(await baux(cle)).toBe(0)

    // Bail d'un autre processus non expiré : rien n'est publié.
    await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${cle}`
    await prisma.$executeRaw`DELETE FROM warehouse.executions WHERE jeu = ${cle}`
    await prisma.$executeRaw`
      INSERT INTO warehouse.verrous_synchronisation (jeu, proprietaire, expire_a)
      VALUES (${cle}, 'autre', now() + interval '10 minutes')`
    expect(await synchroniserEntrepot({ jeu: cle, forcer: true })).toEqual([{ jeu: cle, statut: 'en_cours' }])
    expect(await snapshots(cle)).toBe(0)
    expect(await executions(cle)).toHaveLength(0)
    expect(await baux(cle)).toBe(1)

    // Bail périmé : repris, la synchronisation publie et libère le bail.
    await prisma.$executeRaw`UPDATE warehouse.verrous_synchronisation SET expire_a = now() - interval '1 minute' WHERE jeu = ${cle}`
    expect(await synchroniserEntrepot({ jeu: cle, forcer: true })).toEqual([{ jeu: cle, statut: 'publie' }])
    expect(await snapshots(cle)).toBe(1)
    expect(await baux(cle)).toBe(0)
  }, 90_000)

  // Source lente (la lecture dure environ 2,5 s) pour agir pendant la lecture, hors transaction.
  async function jeuLent(prefixe: string) {
    const sourceId = await creerSource()
    const table = prefixe + suffixe()
    const vue = table + '_lente'
    await creerTable(table)
    await redacteur.$executeRawUnsafe(`CREATE VIEW support.${vue} AS SELECT t.id, t.valeur FROM support.${table} t, pg_sleep(2.5)`)
    objetsSupport.push(`VIEW IF EXISTS support.${vue}`)
    await redacteur.$executeRawUnsafe(`GRANT SELECT ON support.${vue} TO dg_support_reader`)
    return creerJeu(sourceId, 'Lent ' + suffixe(), vue)
  }

  async function attendreBail(cle: string) {
    for (let i = 0; i < 100 && (await baux(cle)) === 0; i++) await new Promise(resolve => setTimeout(resolve, 50))
    expect(await baux(cle)).toBe(1)
  }

  it('abandonne sans rien écrire si le bail est perdu pendant la lecture', async () => {
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const cle = await jeuLent('fiab_bail_')
    const synchro = synchroniserEntrepot({ jeu: cle, forcer: true })
    await attendreBail(cle)
    await prisma.$executeRaw`UPDATE warehouse.verrous_synchronisation SET proprietaire = 'autre' WHERE jeu = ${cle}`
    expect(await synchro).toEqual([{ jeu: cle, statut: 'en_cours', code: 'bail_perdu' }])
    expect(await snapshots(cle)).toBe(0)
    expect(await executions(cle)).toHaveLength(0)
    expect((await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM warehouse.synchronisations WHERE jeu = ${cle}`)[0].n).toBe(0)
    // Le bail de l'autre processus n'est pas libéré par celui qui l'a perdu.
    expect(await baux(cle)).toBe(1)
    expect(avertissement.mock.calls.map(appel => JSON.parse(appel[0] as string))).toContainEqual(
      expect.objectContaining({ domaine: 'synchronisation', jeu: cle, code: 'bail_perdu' }))
  }, 60_000)

  it("n'écrit rien si le jeu est supprimé pendant la lecture", async () => {
    const cle = await jeuLent('fiab_supp_')
    const synchro = synchroniserEntrepot({ jeu: cle, forcer: true })
    await attendreBail(cle)
    // Comme l'administration : sous le verrou du jeu, retire le bail puis l'import.
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'datagenius:warehouse:' + cle}, 0))::text`
      await tx.$executeRaw`DELETE FROM warehouse.verrous_synchronisation WHERE jeu = ${cle}`
      await tx.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${cle}`
    })
    expect(await synchro).toEqual([{ jeu: cle, statut: 'echec', code: 'jeu_supprime' }])
    expect(await snapshots(cle)).toBe(0)
    expect(await executions(cle)).toHaveLength(0)
    expect((await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM warehouse.synchronisations WHERE jeu = ${cle}`)[0].n).toBe(0)
    expect(await baux(cle)).toBe(0)
  }, 60_000)
})
