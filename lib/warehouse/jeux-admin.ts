import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

export type DependancesJeu = {
  combinaisons: { cle: string; titre: string }[]
  tableaux: { id: string; titre: string }[]
  espaces: { id: string; nom: string }[]
  catalogue: boolean
  droits: boolean
  qualite: boolean
  incremental: boolean
}

type Lecteur = { $queryRaw: Prisma.TransactionClient['$queryRaw'] }

/** Dépendances d'un jeu (import ou combinaison), lues avec le client ou la transaction fournis. */
export async function dependancesJeuAvec(client: Lecteur, cle: string): Promise<DependancesJeu> {
  const [combinaisons, tableaux, espaces, drapeaux] = await Promise.all([
    client.$queryRaw<{ cle: string; titre: string }[]>`
      SELECT c.cle, COALESCE(c.definition ->> 'titre', c.cle) AS titre FROM warehouse.combinaisons c
      WHERE c.definition ->> 'gauche' = ${cle} OR c.definition ->> 'droite' = ${cle} ORDER BY 2, 1`,
    client.$queryRaw<{ id: string; titre: string }[]>`
      SELECT t.id::text, COALESCE(t.definition ->> 'titre', '') AS titre FROM warehouse.tableaux t
      WHERE jsonb_typeof(t.definition -> 'tuiles') = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(t.definition -> 'tuiles') x
        WHERE x ->> 'type' = 'mesure' AND x ->> 'jeu' = ${cle}) ORDER BY 2, 1`,
    client.$queryRaw<{ id: string; nom: string }[]>`
      SELECT e.id::text, e.nom FROM warehouse.espaces e
      JOIN warehouse.espaces_jeux j ON j.espace_id = e.id WHERE j.jeu = ${cle} ORDER BY e.nom, e.id`,
    client.$queryRaw<{ catalogue: boolean; droits: boolean; qualite: boolean; incremental: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM warehouse.catalogue_metier WHERE jeu = ${cle}) AS catalogue,
        EXISTS (SELECT 1 FROM warehouse.regles_acces WHERE jeu = ${cle}) AS droits,
        EXISTS (SELECT 1 FROM warehouse.qualite_imports WHERE jeu = ${cle}) AS qualite,
        EXISTS (SELECT 1 FROM warehouse.incremental WHERE jeu = ${cle}) AS incremental`,
  ])
  const { catalogue, droits, qualite, incremental } = drapeaux[0]
  return { combinaisons, tableaux, espaces, catalogue, droits, qualite, incremental }
}

export function dependancesJeu(cle: string): Promise<DependancesJeu> {
  return dependancesJeuAvec(prisma, cle)
}

export function listeTitres(titres: string[]) {
  const affiches = titres.slice(0, 5).map(t => '« ' + t + ' »').join(', ')
  return titres.length > 5 ? affiches + ' et ' + (titres.length - 5) + ' autre(s)' : affiches
}

export async function auditerSuppression(
  tx: Prisma.TransactionClient, acteur: string, action: string, objet: string, revision: boolean,
) {
  if (revision) {
    await tx.$executeRaw`UPDATE warehouse.revision_acces SET revision = revision + 1, depuis = clock_timestamp() WHERE id = 1`
  }
  await tx.$executeRaw`INSERT INTO warehouse.audit_acces (acteur_id, action, objet) VALUES (${acteur}, ${action}, ${objet})`
}

/** Verrous communs aux mutations de jeux, d'espaces et de droits. */
export async function verrouillerJeux(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('datagenius:warehouse:combinaisons', 0))::text`
  await tx.$queryRaw`SELECT id FROM warehouse.revision_acces WHERE id = 1 FOR UPDATE`
}

/** Verrou bloquant de la clé de jeu, partagé avec la publication, la qualité et l'incrémental. */
export async function verrouillerSynchroJeu(tx: Prisma.TransactionClient, cle: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'datagenius:warehouse:' + cle}, 0))::text`
}

/** Dernier code d'échec enregistré pour un jeu (null si aucun). */
export async function dernierCodeExecution(cle: string) {
  const [ligne] = await prisma.$queryRaw<{ code: string | null }[]>`
    SELECT code FROM warehouse.executions WHERE jeu = ${cle} ORDER BY verifie_a DESC, id DESC LIMIT 1`
  return ligne?.code ?? null
}

/** Supprime les données liées à une clé de jeu (hors import/combinaison) ; renvoie vrai si les droits ont changé. */
export async function purgerDonneesJeu(tx: Prisma.TransactionClient, cle: string) {
  await tx.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${cle}`
  await tx.$executeRaw`DELETE FROM warehouse.synchronisations WHERE jeu = ${cle}`
  await tx.$executeRaw`DELETE FROM warehouse.executions WHERE jeu = ${cle}`
  // Table ajoutée par la migration de reprise après échec : absente tant qu'elle n'est pas appliquée.
  const [verrous] = await tx.$queryRaw<{ existe: boolean }[]>`SELECT to_regclass('warehouse.verrous_synchronisation') IS NOT NULL AS existe`
  if (verrous?.existe) await tx.$executeRaw`DELETE FROM warehouse.verrous_synchronisation WHERE jeu = ${cle}`
  await tx.$executeRaw`DELETE FROM warehouse.catalogue_metier WHERE jeu = ${cle}`
  const regles = await tx.$executeRaw`DELETE FROM warehouse.regles_acces WHERE jeu = ${cle}`
  const espaces = await tx.$executeRaw`DELETE FROM warehouse.espaces_jeux WHERE jeu = ${cle}`
  return regles > 0 || espaces > 0
}
