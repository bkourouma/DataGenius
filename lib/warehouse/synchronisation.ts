import { createHash, randomUUID } from 'node:crypto'
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

export type Statut = 'publie' | 'identique' | 'echec' | 'pas_echu' | 'en_cours'
export type ResultatJeu = { jeu: string; statut: Statut; code?: string }
export type ResultatDetaille = ResultatJeu & { dureeMs: number }
type EtatJeu = {
  publie_a: Date | null
  lignes: number | null
  verifie_a: Date | null
  reussi_a: Date | null
  statut: 'publie' | 'identique' | 'echec' | null
  echecs_consecutifs: number | null
  prochain_essai_a: Date | null
}

const BAIL_MS = 5 * 60_000
const RENOUVELLEMENT_MS = 60_000
const BACKOFF_MAX_MINUTES = 60

class ErreurBail extends Error {}
class ErreurJeuSupprime extends Error {}

function codeLecture(erreur: unknown) {
  const sqlstate = (erreur as { meta?: { code?: string } } | null)?.meta?.code
  return ['42703', '42P01', '42846', '22P02', '22003'].includes(sqlstate ?? '') ? 'schema' : 'source'
}

// Classe une exception inattendue : 'delai' (transaction, pool, requête ou verrou expirés) ou 'interne'.
export function codeException(erreur: unknown) {
  const e = erreur as { code?: unknown; meta?: { code?: unknown }; name?: unknown } | null
  const code = typeof e?.code === 'string' ? e.code : ''
  const sqlstate = typeof e?.meta?.code === 'string' ? e.meta.code : ''
  if (['P2028', 'P2024'].includes(code) || ['57014', '55P03'].includes(sqlstate) || e?.name === 'TimeoutError') return 'delai'
  return 'interne'
}

// Cause à journaliser : jamais le message (une requête ou une chaîne de connexion pourrait y figurer).
export function causeJournal(erreur: unknown) {
  const e = erreur as { name?: unknown; code?: unknown; meta?: { code?: unknown } } | null
  return {
    erreur: typeof e?.name === 'string' ? e.name : typeof erreur,
    codeErreur: typeof e?.code === 'string' ? e.code : undefined,
    sqlstate: typeof e?.meta?.code === 'string' ? e.meta.code : undefined,
  }
}

async function prendreBail(jeu: string, proprietaire: string) {
  const lignes = await prisma.$queryRaw<{ jeu: string }[]>`
    INSERT INTO warehouse.verrous_synchronisation (jeu, proprietaire, expire_a)
    VALUES (${jeu}, ${proprietaire}, clock_timestamp() + ${BAIL_MS}::int * interval '1 millisecond')
    ON CONFLICT (jeu) DO UPDATE SET proprietaire = EXCLUDED.proprietaire, expire_a = EXCLUDED.expire_a
    WHERE warehouse.verrous_synchronisation.expire_a <= clock_timestamp()
    RETURNING jeu
  `
  return lignes.length > 0
}

async function renouvelerBail(client: Pick<Prisma.TransactionClient, '$executeRaw'>, jeu: string, proprietaire: string) {
  const modifie = await client.$executeRaw`
    UPDATE warehouse.verrous_synchronisation
    SET expire_a = clock_timestamp() + ${BAIL_MS}::int * interval '1 millisecond'
    WHERE jeu = ${jeu} AND proprietaire = ${proprietaire}
  `
  return modifie > 0
}

async function libererBail(jeu: string, proprietaire: string) {
  await prisma.$executeRaw`DELETE FROM warehouse.verrous_synchronisation WHERE jeu = ${jeu} AND proprietaire = ${proprietaire}`
}

type Enregistrement = {
  entree: JeuEntrepot
  statut: Statut
  code: string | null
  version: number
  versionIncrementale: number | null
  frequence: number
  debut: number
  lignesLues: number | null
  lignesValides: number | null
  mode: 'delta' | 'reconciliation' | null
}

// Écrit l'état de synchronisation (avec le backoff), la fraîcheur de la copie et la ligne d'exécution.
async function enregistrer(tx: Prisma.TransactionClient, p: Enregistrement) {
  const { jeu, empreinte } = p.entree
  const echec = p.statut === 'echec'
  // Une empreinte différente (source reconfigurée) repart d'un compteur d'échecs à zéro.
  const echecsAnterieurs = Prisma.sql`(CASE WHEN warehouse.synchronisations.empreinte = EXCLUDED.empreinte
    THEN warehouse.synchronisations.echecs_consecutifs ELSE 0 END)`
  await tx.$executeRaw`
    INSERT INTO warehouse.synchronisations
      (jeu, empreinte, verifie_a, statut, qualite_version, incremental_version, reussi_a, echecs_consecutifs, prochain_essai_a)
    VALUES (${jeu.cle}, ${empreinte}, clock_timestamp(), ${p.statut}, ${p.version}, ${p.versionIncrementale},
      CASE WHEN ${echec} THEN NULL ELSE clock_timestamp() END,
      CASE WHEN ${echec} THEN 1 ELSE 0 END,
      CASE WHEN ${echec} THEN clock_timestamp() +
        least(2, ${BACKOFF_MAX_MINUTES}, ${p.frequence}::int) * interval '1 minute' END)
    ON CONFLICT (jeu) DO UPDATE SET empreinte = EXCLUDED.empreinte,
      verifie_a = EXCLUDED.verifie_a, statut = EXCLUDED.statut, qualite_version = EXCLUDED.qualite_version,
      incremental_version = EXCLUDED.incremental_version,
      reussi_a = coalesce(EXCLUDED.reussi_a, warehouse.synchronisations.reussi_a),
      echecs_consecutifs = CASE WHEN ${echec} THEN ${echecsAnterieurs} + 1 ELSE 0 END,
      prochain_essai_a = CASE WHEN ${echec} THEN clock_timestamp() +
        least(power(2, least(${echecsAnterieurs} + 1, 10)), ${BACKOFF_MAX_MINUTES}, ${p.frequence}::int) * interval '1 minute' END
  `
  await tx.$executeRaw`
    UPDATE warehouse.snapshots s
    SET verifie_a = t.verifie_a, verification_ok = t.statut <> 'echec',
      fraiche_jusqua = t.reussi_a + ${p.frequence}::int * interval '1 minute',
      reconcilie_a = CASE WHEN t.statut = 'echec' THEN s.reconcilie_a
        ELSE (SELECT reconcilie_a FROM warehouse.incremental WHERE jeu = ${jeu.cle}) END
    FROM warehouse.synchronisations t
    WHERE s.jeu = ${jeu.cle} AND s.jeu = t.jeu AND s.empreinte = t.empreinte
  `
  await tx.$executeRaw`
    INSERT INTO warehouse.executions (jeu, empreinte, qualite_version, duree_ms, statut, lignes_lues, lignes_valides, code, mode_lecture)
    VALUES (${jeu.cle}, ${empreinte}, ${p.version}, ${Math.max(0, Date.now() - p.debut)}, ${p.statut}, ${p.lignesLues},
      ${p.lignesValides}, ${p.code}, ${p.mode})
  `
}

// Début de toute écriture d'état : verrou du jeu (partagé avec l'administration, qui supprime ou modifie le jeu
// sous ce verrou), existence du jeu, puis bail encore détenu. Sinon, rien ne doit être écrit.
async function verifierExclusivite(tx: Prisma.TransactionClient, entree: JeuEntrepot, proprietaire: string) {
  const { jeu, source } = entree
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'datagenius:warehouse:' + jeu.cle}, 0))::text`
  // Les jeux du catalogue fichier (source.connexion) n'ont pas de ligne dans warehouse.imports.
  if (!source.connexion) {
    const [existe] = await tx.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM warehouse.imports WHERE cle = ${jeu.cle}) AS present
    `
    if (!existe?.present) throw new ErreurJeuSupprime()
  }
  // Si le bail a expiré ou a été retiré pendant la lecture, un autre processus peut traiter le jeu.
  if (!(await renouvelerBail(tx, jeu.cle, proprietaire))) throw new ErreurBail()
}

// Échec inattendu : écrit dans une transaction neuve, car celle de publication est annulée.
async function enregistrerEchecInterne(entree: JeuEntrepot, code: string, debut: number, proprietaire: string) {
  const { jeu } = entree
  await prisma.$transaction(async tx => {
    await verifierExclusivite(tx, entree, proprietaire)
    const [etat] = await tx.$queryRaw<{ version: number | null; incremental: number | null; reconciliation: number | null }[]>`
      SELECT (SELECT version FROM warehouse.qualite_imports WHERE jeu = ${jeu.cle}) AS version,
        i.version AS incremental, (i.definition->>'reconciliationMinutes')::int AS reconciliation
      FROM (SELECT 1) AS un LEFT JOIN warehouse.incremental i ON i.jeu = ${jeu.cle}
    `
    await enregistrer(tx, {
      entree, statut: 'echec', code, version: etat?.version ?? 0, versionIncrementale: etat?.incremental ?? null,
      frequence: Math.min(jeu.frequenceMinutes, etat?.reconciliation ?? jeu.frequenceMinutes), debut,
      lignesLues: null, lignesValides: null, mode: null,
    })
  }, { timeout: 10_000, maxWait: 5_000 })
}

async function executerJeu(
  entree: JeuEntrepot, forcer: boolean, reconcilier: boolean, proprietaire: string, debut: number,
): Promise<{ statut: Statut; code: string | null }> {
  const { jeu, empreinte } = entree

  // Phase 1 : états courants (lectures courtes, sans transaction).
  const [qualite] = await prisma.$queryRaw<{ version: number; definition: unknown }[]>`
    SELECT version, definition FROM warehouse.qualite_imports WHERE jeu = ${jeu.cle}
  `
  const version = qualite?.version ?? 0
  const [dernier] = await prisma.$queryRaw<{
    verifie_a: Date; qualite_version: number; incremental_version: number | null; en_attente: boolean; statut: string
  }[]>`
    SELECT verifie_a, qualite_version, incremental_version, statut,
      coalesce(prochain_essai_a > clock_timestamp(), false) AS en_attente
    FROM warehouse.synchronisations WHERE jeu = ${jeu.cle} AND empreinte = ${empreinte}
  `
  const [configurationIncrementale] = await prisma.$queryRaw<{ version: number; frequence: number; reconcilie_a: Date | null }[]>`
    SELECT version, reconcilie_a, (definition->>'reconciliationMinutes')::int AS frequence
    FROM warehouse.incremental WHERE jeu = ${jeu.cle}
  `
  const versionIncrementale = configurationIncrementale?.version ?? null
  const frequence = Math.min(jeu.frequenceMinutes, configurationIncrementale?.frequence ?? jeu.frequenceMinutes)
  const prochaineReconciliation = configurationIncrementale?.reconcilie_a
    ? configurationIncrementale.reconcilie_a.getTime() + configurationIncrementale.frequence * 60_000 : Infinity
  const reconciliationEchue = Date.now() >= prochaineReconciliation &&
    (!dernier || dernier.verifie_a.getTime() < prochaineReconciliation)
  const configurationInchangee = dernier?.incremental_version === versionIncrementale && dernier?.qualite_version === version
  // Backoff : un jeu en échec n'est retenté qu'à partir de prochain_essai_a, sauf synchronisation manuelle
  // ou configuration modifiée depuis le dernier essai.
  if (!forcer && !reconcilier && configurationInchangee && dernier?.en_attente) return { statut: 'pas_echu', code: 'backoff' }
  // Après un échec, seul le backoff décide du prochain essai (la fréquence du jeu ne s'applique pas).
  if (!forcer && !reconcilier && !reconciliationEchue && configurationInchangee && dernier.statut !== 'echec' &&
      Date.now() - dernier.verifie_a.getTime() < frequence * 60_000) {
    return { statut: 'pas_echu', code: null }
  }

  // Phase 2 : lecture de la source et contrôle qualité, hors transaction interne.
  let code: string | null = null
  let contenu: string | null = null
  let lignesLues: number | null = null
  let lignesValides: number | null = null
  let lectureIncrementale: Awaited<ReturnType<typeof lireIncremental>> | undefined
  try {
    if (configurationIncrementale) {
      const [etat] = await prisma.$queryRaw<EtatIncremental[]>`
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

  // Phase 3 : publication atomique dans une transaction courte, sans E/S externe.
  return prisma.$transaction(async tx => {
    // Sérialisée avec les modifications d'administration du jeu ; échoue sans rien écrire si le jeu a été
    // supprimé ou si le bail est perdu.
    await verifierExclusivite(tx, entree, proprietaire)
    const [courant] = await tx.$queryRaw<{ qualite: number | null; incremental: number | null }[]>`
      SELECT (SELECT version FROM warehouse.qualite_imports WHERE jeu = ${jeu.cle}) AS qualite,
        (SELECT version FROM warehouse.incremental WHERE jeu = ${jeu.cle}) AS incremental
    `
    if ((courant?.qualite ?? 0) !== version || (courant?.incremental ?? null) !== versionIncrementale) {
      // La configuration a changé pendant la lecture : on ne publie pas une copie obsolète.
      code = 'configuration_modifiee'
      contenu = null
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
    await enregistrer(tx, {
      entree, statut, code, version, versionIncrementale, frequence, debut, lignesLues, lignesValides,
      mode: lectureIncrementale ? lectureIncrementale.reconciliation ? 'reconciliation' : 'delta' : null,
    })
    return { statut, code }
  }, { timeout: 30_000, maxWait: 5_000 })
}

async function synchroniserJeu(entree: JeuEntrepot, forcer: boolean, reconcilier: boolean): Promise<ResultatDetaille> {
  const { jeu } = entree
  const debut = Date.now()
  const proprietaire = randomUUID()
  const resultat = (statut: Statut, code: string | null): ResultatDetaille =>
    ({ jeu: jeu.cle, statut, ...(code ? { code } : {}), dureeMs: Math.max(0, Date.now() - debut) })
  const bailPerdu = () => {
    console.warn('[datagenius] synchronisation', { jeu: jeu.cle, code: 'bail_perdu', dureeMs: Math.max(0, Date.now() - debut) })
    return resultat('en_cours', 'bail_perdu')
  }
  let bail = false
  let battement: ReturnType<typeof setInterval> | undefined
  try {
    // Exclusivité par jeu : bail en table plutôt que verrou de session, qui exigerait une connexion
    // dédiée gardée pendant toute la lecture. Le bail est renouvelé pendant la lecture et vérifié à la publication.
    if (!(await prendreBail(jeu.cle, proprietaire))) return resultat('en_cours', null)
    bail = true
    battement = setInterval(() => {
      renouvelerBail(prisma, jeu.cle, proprietaire).catch(() => undefined)
    }, RENOUVELLEMENT_MS)
    battement.unref()
    const { statut, code } = await executerJeu(entree, forcer, reconcilier, proprietaire, debut)
    return resultat(statut, code)
  } catch (erreur) {
    if (erreur instanceof ErreurBail) return bailPerdu()
    if (erreur instanceof ErreurJeuSupprime) return resultat('echec', 'jeu_supprime')
    const code = codeException(erreur)
    console.error('[datagenius] synchronisation', { jeu: jeu.cle, code, ...causeJournal(erreur), dureeMs: Date.now() - debut })
    try {
      await enregistrerEchecInterne(entree, code, debut, proprietaire)
    } catch (secondaire) {
      if (secondaire instanceof ErreurBail) return bailPerdu()
      if (secondaire instanceof ErreurJeuSupprime) return resultat('echec', 'jeu_supprime')
      console.error('[datagenius] synchronisation', {
        jeu: jeu.cle, code: 'enregistrement_impossible', ...causeJournal(secondaire),
      })
    }
    return resultat('echec', code)
  } finally {
    if (battement) clearInterval(battement)
    if (bail) await libererBail(jeu.cle, proprietaire).catch(() => undefined)
  }
}

type OptionsSynchronisation = { forcer?: boolean; reconcilier?: boolean; jeu?: string; signal?: AbortSignal }

// Traite chaque jeu isolément : une exception sur un jeu n'empêche pas les suivants.
export async function synchroniserEntrepotDetaille(options: OptionsSynchronisation = {}) {
  const entrees = (await jeuxEntrepot()).filter(e => !options.jeu || e.jeu.cle === options.jeu)
  const resultats: ResultatDetaille[] = []
  for (const entree of entrees) {
    // Arrêt demandé : on termine le jeu en cours, pas les suivants.
    if (options.signal?.aborted) break
    resultats.push(await synchroniserJeu(entree, options.forcer ?? false, options.reconcilier ?? false))
  }
  return resultats
}

export async function synchroniserEntrepot(options: OptionsSynchronisation = {}): Promise<ResultatJeu[]> {
  return (await synchroniserEntrepotDetaille(options)).map(({ jeu, statut, code }) =>
    code ? { jeu, statut, code } : { jeu, statut })
}

export const RETENTION_JOURS = 90
export const RETENTION_LIGNES = 1000
const INTERVALLE_PURGE_MS = 60 * 60_000
let dernierePurge = 0

// Supprime les exécutions qui dépassent à la fois 90 jours et les 1 000 dernières lignes du jeu.
export async function purgerExecutions(jours = RETENTION_JOURS, lignes = RETENTION_LIGNES) {
  return prisma.$executeRaw`
    DELETE FROM warehouse.executions e
    USING (
      SELECT id, row_number() OVER (PARTITION BY jeu ORDER BY verifie_a DESC, id DESC) AS rang
      FROM warehouse.executions
    ) r
    WHERE e.id = r.id AND r.rang > ${lignes}::int
      AND e.verifie_a < clock_timestamp() - ${jours}::int * interval '1 day'
  `
}

// Purge au plus une fois par heure et par processus ; renvoie null si elle n'est pas encore échue.
export async function purgerExecutionsSiEchu(maintenant = Date.now(), intervalleMs = INTERVALLE_PURGE_MS) {
  if (maintenant - dernierePurge < intervalleMs) return null
  dernierePurge = maintenant
  return purgerExecutions()
}

export async function etatEntrepot() {
  const entrees = await jeuxEntrepot()
  if (!entrees.length) return []
  const cles = Prisma.join(entrees.map(({ jeu }) => jeu.cle))
  const etats = await prisma.$queryRaw<(EtatJeu & { jeu: string; empreinte: string })[]>`
    SELECT coalesce(s.jeu, t.jeu) AS jeu, coalesce(s.empreinte, t.empreinte) AS empreinte,
      s.publie_a, s.lignes, t.verifie_a, t.reussi_a, t.statut, t.echecs_consecutifs, t.prochain_essai_a
    FROM warehouse.snapshots s FULL OUTER JOIN warehouse.synchronisations t
      ON s.jeu = t.jeu AND s.empreinte = t.empreinte
    WHERE coalesce(s.jeu, t.jeu) IN (${cles})
  `
  return entrees.map(({ jeu, source, empreinte }) => ({
    cle: jeu.cle, titre: jeu.titre, source: source.titre, frequence: jeu.frequenceMinutes, modifiable: !source.connexion,
    etat: etats.find(e => e.jeu === jeu.cle && e.empreinte === empreinte) ?? null,
  }))
}
