/**
 * Accès à un jeu de données par id. Le contrôle d'accès est DANS la requête de lecture : une
 * ligne n'est jamais lue puis vérifiée après coup. Une ligne absente ou inaccessible donne la
 * même `ErreurDonnees('introuvable')` au même message.
 *
 * Un jeu est accessible si :
 *  1. il appartient au lecteur ;
 *  2. il est référencé par un artefact (toutes versions du même `racineId`) partagé au lecteur
 *     (`ressourceId` = id d'une version OU `racineId`) ;
 *  3. il est référencé par un artefact dont le lecteur a épinglé la racine ;
 *  4. il appartient à une conversation partagée au lecteur.
 *
 * Prisma ne sait pas écrire un `@>` JSON avec relation : une requête brute, dont chaque valeur
 * (id du jeu, id du lecteur) est un PARAMÈTRE (Prisma.sql), jamais concaténée.
 */

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { empreinteCatalogueHistorique, empreinteRequete, registrePostgres } from '@/lib/medic-assist/donnees/catalogue/registre'
import { ErreurDonnees } from '@/lib/medic-assist/donnees/types'
import { MESSAGE_JEU_INTROUVABLE } from './types'

/** Ligne de `assistant_jeux_de_donnees` lue par la requête d'accès. */
export interface LigneJeuStockee {
  id: string
  userId: string
  conversationId: string | null
  source: string
  requete: unknown
  colonnes: unknown
  lignes: unknown
  nbLignes: number
  tronque: boolean
  provenance: unknown
  empreintePerimetre: string
  empreinteSource: string | null
  calculeA: Date
}

/** Longueur maximale plausible d'un identifiant (cuid) ; au-delà, c'est forcément « introuvable ». */
const LONGUEUR_MAX_ID = 128

export function erreurIntrouvable(): ErreurDonnees {
  return new ErreurDonnees(MESSAGE_JEU_INTROUVABLE, 'introuvable')
}

/** Requête d'accès paramétrée (exportée pour les tests : aucune valeur n'y est concaténée). */
export function requeteAccesJeu(id: string, userId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT j."id", j."userId", j."conversationId", j."source", j."requete", j."colonnes",
           j."lignes", j."nbLignes", j."tronque", j."provenance", j."empreintePerimetre",
           j."calculeA", j."empreinteSource"
    FROM "assistant_jeux_de_donnees" j
    WHERE j."id" = ${id}
      AND (
        j."userId" = ${userId}
        OR EXISTS (
          SELECT 1
          FROM "assistant_artefacts" a
          WHERE a."jeuxDeDonneesIds" @> jsonb_build_array(${id}::text)
            AND (
              EXISTS (
                SELECT 1
                FROM "assistant_partages" p
                WHERE p."ressourceType" = 'artefact'
                  AND p."aUserId" = ${userId}
                  AND (
                    p."ressourceId" = a."racineId"
                    OR p."ressourceId" IN (
                      SELECT v."id" FROM "assistant_artefacts" v WHERE v."racineId" = a."racineId"
                    )
                  )
              )
              OR EXISTS (
                SELECT 1
                FROM "assistant_epingles" e
                WHERE e."userId" = ${userId}
                  AND e."artefactRacineId" = a."racineId"
              )
            )
        )
        OR (
          j."conversationId" IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "assistant_partages" pc
            WHERE pc."ressourceType" = 'conversation'
              AND pc."ressourceId" = j."conversationId"
              AND pc."aUserId" = ${userId}
          )
        )
      )
    LIMIT 1
  `
}

/** Charge le jeu `id` s'il est accessible à `contexte.userId`, sinon lève `introuvable`. */
export async function chargerJeuAccessible(
  id: string,
  contexte: Pick<ContexteExecution, 'userId'>
): Promise<LigneJeuStockee> {
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > LONGUEUR_MAX_ID ||
    typeof contexte.userId !== 'string' ||
    contexte.userId.length === 0
  ) {
    throw erreurIntrouvable()
  }
  const lignes = await prisma.$queryRaw<LigneJeuStockee[]>(requeteAccesJeu(id, contexte.userId))
  const ligne = lignes[0]
  await verifierSource(ligne)
  return ligne
}

/**
 * Charge le jeu `id` appartenant à `proprietaireId` (lecture au nom d'un artefact déjà vérifié
 * par le lot 4). Id et propriétaire sont dans le MÊME where ; absent ou autre propriétaire :
 * la même erreur `introuvable`.
 */
export async function chargerJeuDuProprietaire(
  id: string,
  proprietaireId: string
): Promise<LigneJeuStockee> {
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > LONGUEUR_MAX_ID ||
    typeof proprietaireId !== 'string' ||
    proprietaireId.length === 0
  ) {
    throw erreurIntrouvable()
  }
  const ligne = await prisma.assistantJeuDeDonnees.findFirst({
    where: { id, userId: proprietaireId },
  })
  await verifierSource(ligne)
  return ligne as LigneJeuStockee
}

async function verifierSource(ligne: LigneJeuStockee | null | undefined): Promise<void> {
  if (!ligne) throw erreurIntrouvable()
  if (ligne.source === 'piece_jointe') return
  if (!ligne.empreinteSource) throw erreurIntrouvable()
  if (ligne.empreinteSource === empreinteCatalogueHistorique()) return
  const actuelle = empreinteRequete(ligne.source, ligne.requete, await registrePostgres())
  if (ligne.empreinteSource !== actuelle) throw erreurIntrouvable()
}
