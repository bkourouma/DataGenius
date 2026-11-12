import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { citer, jeuxEntrepot, typeSql, type JeuEntrepot } from './configuration'
import { transactionLecture, transactionLectureUrl } from './postgres'
import { urlSource } from './sources-admin'

const MAX_LIGNES = 50_000
const MAX_OCTETS = 20 * 1024 * 1024

async function lireSource({ jeu, source }: JeuEntrepot) {
  async function lire(tx: Prisma.TransactionClient) {
    const colonnes = jeu.colonnes.map(c =>
      Prisma.sql`(${citer(c.origine ?? c.nom)}::${typeSql(c.type)})::text AS ${citer(c.nom)}`,
    )
    const [resultat] = await tx.$queryRaw<{ lignes: number; contenu: string | null }[]>`
      WITH selection AS MATERIALIZED (
        SELECT pg_catalog.to_jsonb(ligne)::text AS contenu
        FROM (
          SELECT ${Prisma.join(colonnes)}
          FROM ${citer(jeu.schema)}.${citer(jeu.table)}
          LIMIT ${MAX_LIGNES + 1}
        ) AS ligne
      ), volume AS (
        SELECT count(*)::int AS lignes, coalesce(sum(octet_length(contenu)::bigint + 1), 0) AS octets
        FROM selection
      )
      SELECT lignes,
        CASE WHEN lignes <= ${MAX_LIGNES} AND octets <= ${MAX_OCTETS}
          THEN '[' || coalesce((
            SELECT string_agg(contenu, ',' ORDER BY contenu COLLATE pg_catalog."C") FROM selection
          ), '') || ']'
        END AS contenu
      FROM volume
    `
    if (!resultat || resultat.contenu === null) throw new Error('Volume maximal de synchronisation dépassé.')
    return { lignes: resultat.lignes, contenu: resultat.contenu }
  }
  return source.connexion ? transactionLecture(source.connexion, lire) : transactionLectureUrl(await urlSource(source.id), lire)
}

type Statut = 'publie' | 'identique' | 'echec' | 'pas_echu' | 'en_cours'
type EtatJeu = {
  publie_a: Date | null
  lignes: number | null
  verifie_a: Date | null
  statut: 'publie' | 'identique' | 'echec' | null
}

async function synchroniserJeu(entree: JeuEntrepot, forcer: boolean): Promise<Statut> {
  const { jeu, empreinte } = entree
  return prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<{ acquis: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${'datagenius:warehouse:' + jeu.cle}, 0)) AS acquis
    `
    if (!lock?.acquis) return 'en_cours'

    const [dernier] = await tx.$queryRaw<{ verifie_a: Date }[]>`
      SELECT verifie_a FROM warehouse.synchronisations WHERE jeu = ${jeu.cle} AND empreinte = ${empreinte}
    `
    if (!forcer && dernier && Date.now() - dernier.verifie_a.getTime() < jeu.frequenceMinutes * 60_000) {
      return 'pas_echu'
    }

    let lecture: Awaited<ReturnType<typeof lireSource>> | undefined
    try {
      lecture = await lireSource(entree)
    } catch {
      // La copie déjà publiée reste disponible. Aucun détail de connexion ni de données n'est journalisé.
    }

    let statut: Statut = 'echec'
    if (lecture) {
      const hash = createHash('sha256').update(lecture.contenu).digest('hex')
      const modifie = await tx.$executeRaw`
        INSERT INTO warehouse.snapshots (jeu, empreinte, contenu, hash, lignes)
        VALUES (${jeu.cle}, ${empreinte}, ${lecture.contenu}::jsonb, ${hash}, ${lecture.lignes})
        ON CONFLICT (jeu) DO UPDATE SET
          empreinte = EXCLUDED.empreinte, contenu = EXCLUDED.contenu, hash = EXCLUDED.hash,
          lignes = EXCLUDED.lignes, publie_a = clock_timestamp()
        WHERE (snapshots.empreinte, snapshots.hash) IS DISTINCT FROM (EXCLUDED.empreinte, EXCLUDED.hash)
      `
      statut = modifie ? 'publie' : 'identique'
    }

    await tx.$executeRaw`
      INSERT INTO warehouse.synchronisations (jeu, empreinte, verifie_a, statut)
      VALUES (${jeu.cle}, ${empreinte}, clock_timestamp(), ${statut})
      ON CONFLICT (jeu) DO UPDATE SET empreinte = EXCLUDED.empreinte,
        verifie_a = EXCLUDED.verifie_a, statut = EXCLUDED.statut
    `
    return statut
  }, { timeout: 30_000, maxWait: 5_000 })
}

export async function synchroniserEntrepot(options: { forcer?: boolean; jeu?: string } = {}) {
  const entrees = (await jeuxEntrepot()).filter(e => !options.jeu || e.jeu.cle === options.jeu)
  const resultats: { jeu: string; statut: Statut }[] = []
  for (const entree of entrees) {
    const statut = await synchroniserJeu(entree, options.forcer ?? false)
    resultats.push({ jeu: entree.jeu.cle, statut })
  }
  return resultats
}

export async function etatEntrepot() {
  const entrees = await jeuxEntrepot()
  if (!entrees.length) return []
  const cles = Prisma.join(entrees.map(({ jeu }) => jeu.cle))
  const etats = await prisma.$queryRaw<(EtatJeu & { jeu: string; empreinte: string })[]>`
    SELECT coalesce(s.jeu, t.jeu) AS jeu, coalesce(s.empreinte, t.empreinte) AS empreinte,
      s.publie_a, s.lignes, t.verifie_a, t.statut
    FROM warehouse.snapshots s FULL OUTER JOIN warehouse.synchronisations t
      ON s.jeu = t.jeu AND s.empreinte = t.empreinte
    WHERE coalesce(s.jeu, t.jeu) IN (${cles})
  `
  return entrees.map(({ jeu, source, empreinte }) => ({
    cle: jeu.cle, titre: jeu.titre, source: source.titre, frequence: jeu.frequenceMinutes, modifiable: !source.connexion,
    etat: etats.find(e => e.jeu === jeu.cle && e.empreinte === empreinte) ?? null,
  }))
}
