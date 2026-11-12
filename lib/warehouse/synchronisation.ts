import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { citer, jeuxEntrepot, typeSql, type JeuEntrepot } from './configuration'
import { transactionLecture, transactionLectureUrl } from './postgres'
import { preparerLignes, validerDefinitionQualite, type LigneImport } from './qualite'
import { lireSourceExterne, urlSource } from './sources-admin'
import { ErreurIncrementale, lireIncremental, type EtatIncremental } from './incremental'

const MAX_LIGNES = 50_000
const MAX_OCTETS = 20 * 1024 * 1024

async function lireSource({ jeu, source }: JeuEntrepot) {
  if (source.type && source.type !== 'postgresql') return lireSourceExterne(source.id, source.type, jeu)
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
    return resultat ?? { lignes: 0, contenu: null }
  }
  return source.connexion ? transactionLecture(source.connexion, lire) : transactionLectureUrl(await urlSource(source.id), lire)
}

type Statut = 'publie' | 'identique' | 'echec' | 'pas_echu' | 'en_cours'
type EtatJeu = {
  publie_a: Date | null
  lignes: number | null
  verifie_a: Date | null
  reussi_a: Date | null
  statut: 'publie' | 'identique' | 'echec' | null
}

function codeLecture(erreur: unknown) {
  const sqlstate = (erreur as { meta?: { code?: string } } | null)?.meta?.code
  return ['42703', '42P01', '42846', '22P02', '22003'].includes(sqlstate ?? '') ? 'schema' : 'source'
}

async function synchroniserJeu(entree: JeuEntrepot, forcer: boolean, reconcilier: boolean): Promise<Statut> {
  const { jeu, empreinte } = entree
  return prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<{ acquis: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${'datagenius:warehouse:' + jeu.cle}, 0)) AS acquis
    `
    if (!lock?.acquis) return 'en_cours'

    const [qualite] = await tx.$queryRaw<{ version: number; definition: unknown }[]>`
      SELECT version, definition FROM warehouse.qualite_imports WHERE jeu = ${jeu.cle}
    `
    const version = qualite?.version ?? 0
    const [dernier] = await tx.$queryRaw<{ verifie_a: Date; qualite_version: number; incremental_version: number | null }[]>`
      SELECT verifie_a, qualite_version, incremental_version
      FROM warehouse.synchronisations WHERE jeu = ${jeu.cle} AND empreinte = ${empreinte}
    `
    const [configurationIncrementale] = await tx.$queryRaw<{ version: number; frequence: number; reconcilie_a: Date | null }[]>`
      SELECT version, reconcilie_a, (definition->>'reconciliationMinutes')::int AS frequence
      FROM warehouse.incremental WHERE jeu = ${jeu.cle}
    `
    const versionIncrementale = configurationIncrementale?.version ?? null
    const frequence = Math.min(jeu.frequenceMinutes, configurationIncrementale?.frequence ?? jeu.frequenceMinutes)
    const prochaineReconciliation = configurationIncrementale?.reconcilie_a
      ? configurationIncrementale.reconcilie_a.getTime() + configurationIncrementale.frequence * 60_000 : Infinity
    const reconciliationEchue = Date.now() >= prochaineReconciliation &&
      (!dernier || dernier.verifie_a.getTime() < prochaineReconciliation)
    if (!forcer && !reconcilier && !reconciliationEchue && dernier?.incremental_version === versionIncrementale &&
        dernier?.qualite_version === version && Date.now() - dernier.verifie_a.getTime() < frequence * 60_000) {
      return 'pas_echu'
    }

    const debut = Date.now()
    let code: string | null = null
    let contenu: string | null = null
    let lignesLues: number | null = null
    let lignesValides: number | null = null
    let lectureIncrementale: Awaited<ReturnType<typeof lireIncremental>> | undefined
    try {
      if (configurationIncrementale) {
        const [etat] = await tx.$queryRaw<EtatIncremental[]>`
          SELECT version, definition, empreinte, contenu, curseur, reconcilie_a
          FROM warehouse.incremental WHERE jeu = ${jeu.cle}
        `
        lectureIncrementale = await lireIncremental(entree, etat, reconcilier)
      }
      const lecture = lectureIncrementale ?? await lireSource(entree)
      lignesLues = lectureIncrementale?.lignesLues ?? lecture.lignes
      lignesValides = lecture.contenu === null ? null : lecture.lignes
      contenu = lecture.contenu
      if (contenu === null) code = 'volume'
    } catch (erreur) {
      code = erreur instanceof ErreurIncrementale ? erreur.code : codeLecture(erreur)
    }

    if (qualite && contenu !== null) {
      try {
        const definition = validerDefinitionQualite(jeu, qualite.definition)
        if (definition.filtres.length || definition.normalisations.length || definition.controles.length) {
          const preparation = preparerLignes(jeu, definition, JSON.parse(contenu) as LigneImport[])
          code = preparation.code
          lignesValides = code ? null : preparation.selection.length
          if (definition.filtres.length || definition.normalisations.length) {
            const lignes = preparation.selection.map(ligne => JSON.stringify(ligne)).sort()
            contenu = '[' + lignes.join(',') + ']'
            if (Buffer.byteLength(contenu) > MAX_OCTETS) code = 'volume'
          }
        }
      } catch {
        code = 'configuration'
        lignesValides = null
      }
    }

    let statut: Statut = 'echec'
    if (!code && contenu !== null && lignesValides !== null) {
      const hash = createHash('sha256').update(contenu).digest('hex')
      const modifie = await tx.$executeRaw`
        INSERT INTO warehouse.snapshots (jeu, empreinte, contenu, hash, lignes)
        VALUES (${jeu.cle}, ${empreinte}, ${contenu}::jsonb, ${hash}, ${lignesValides})
        ON CONFLICT (jeu) DO UPDATE SET
          empreinte = EXCLUDED.empreinte, contenu = EXCLUDED.contenu, hash = EXCLUDED.hash,
          lignes = EXCLUDED.lignes, publie_a = clock_timestamp()
        WHERE (snapshots.empreinte, snapshots.hash) IS DISTINCT FROM (EXCLUDED.empreinte, EXCLUDED.hash)
      `
      statut = modifie ? 'publie' : 'identique'
      if (lectureIncrementale) {
        const { contenu: brut, curseur, reconciliation } = lectureIncrementale
        await tx.$executeRaw`
          UPDATE warehouse.incremental SET empreinte = ${empreinte}, contenu = ${brut}::jsonb, curseur = ${curseur},
            reconcilie_a = CASE WHEN ${reconciliation} THEN clock_timestamp() ELSE reconcilie_a END
          WHERE jeu = ${jeu.cle}
        `
      }
    }

    await tx.$executeRaw`
      INSERT INTO warehouse.synchronisations (jeu, empreinte, verifie_a, statut, qualite_version, incremental_version, reussi_a)
      VALUES (${jeu.cle}, ${empreinte}, clock_timestamp(), ${statut}, ${version}, ${versionIncrementale},
        CASE WHEN ${statut} = 'echec' THEN NULL ELSE clock_timestamp() END)
      ON CONFLICT (jeu) DO UPDATE SET empreinte = EXCLUDED.empreinte,
        verifie_a = EXCLUDED.verifie_a, statut = EXCLUDED.statut, qualite_version = EXCLUDED.qualite_version,
        incremental_version = EXCLUDED.incremental_version,
        reussi_a = coalesce(EXCLUDED.reussi_a, warehouse.synchronisations.reussi_a)
    `
    await tx.$executeRaw`
      UPDATE warehouse.snapshots s
      SET verifie_a = t.verifie_a, verification_ok = t.statut <> 'echec',
        fraiche_jusqua = t.reussi_a + ${frequence}::int * interval '1 minute',
        reconcilie_a = CASE WHEN t.statut = 'echec' THEN s.reconcilie_a
          ELSE (SELECT reconcilie_a FROM warehouse.incremental WHERE jeu = ${jeu.cle}) END
      FROM warehouse.synchronisations t
      WHERE s.jeu = ${jeu.cle} AND s.jeu = t.jeu AND s.empreinte = t.empreinte
    `
    await tx.$executeRaw`
      INSERT INTO warehouse.executions (jeu, empreinte, qualite_version, duree_ms, statut, lignes_lues, lignes_valides, code, mode_lecture)
      VALUES (${jeu.cle}, ${empreinte}, ${version}, ${Math.max(0, Date.now() - debut)}, ${statut}, ${lignesLues}, ${lignesValides}, ${code},
        ${lectureIncrementale ? lectureIncrementale.reconciliation ? 'reconciliation' : 'delta' : null})
    `
    return statut
  }, { timeout: 30_000, maxWait: 5_000 })
}

export async function synchroniserEntrepot(options: { forcer?: boolean; reconcilier?: boolean; jeu?: string } = {}) {
  const entrees = (await jeuxEntrepot()).filter(e => !options.jeu || e.jeu.cle === options.jeu)
  const resultats: { jeu: string; statut: Statut }[] = []
  for (const entree of entrees) {
    const statut = await synchroniserJeu(entree, options.forcer ?? false, options.reconcilier ?? false)
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
      s.publie_a, s.lignes, t.verifie_a, t.reussi_a, t.statut
    FROM warehouse.snapshots s FULL OUTER JOIN warehouse.synchronisations t
      ON s.jeu = t.jeu AND s.empreinte = t.empreinte
    WHERE coalesce(s.jeu, t.jeu) IN (${cles})
  `
  return entrees.map(({ jeu, source, empreinte }) => ({
    cle: jeu.cle, titre: jeu.titre, source: source.titre, frequence: jeu.frequenceMinutes, modifiable: !source.connexion,
    etat: etats.find(e => e.jeu === jeu.cle && e.empreinte === empreinte) ?? null,
  }))
}
