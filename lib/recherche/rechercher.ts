import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { listerGlossaire } from '@/lib/glossaire/glossaire'
import { journal } from '@/lib/journal'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { ressourceDansPerimetre } from '@/lib/medic-assist/suivi/perimetre-ressource'
import { contient } from './sql'

export type TypeResultat = 'tableau' | 'analyse' | 'glossaire' | 'source'

export interface ResultatRecherche {
  type: TypeResultat
  id: string
  titre: string
  detail?: string
  href: string
}

export const LONGUEUR_MIN = 2
export const LONGUEUR_MAX = 100
export const MAX_PAR_TYPE = 10
/** Analyses : pages de 40 lignes lues au plus (200 lignes) pour atteindre 10 résultats dans le périmètre. */
const TAILLE_PAGE_ANALYSES = 40
const PAGES_ANALYSES_MAX = 5

/** Requête exploitable : texte trimé de 2 à 100 caractères, sinon null. */
export function requeteValide(q: string): string | null {
  const requete = q.trim()
  return requete.length >= LONGUEUR_MIN && requete.length <= LONGUEUR_MAX ? requete : null
}

async function tableaux(contexte: ContexteExecution, q: string): Promise<ResultatRecherche[]> {
  const lignes = await prisma.$queryRaw<{ id: string; titre: string }[]>`
    SELECT t.id::text AS id, t.definition ->> 'titre' AS titre
    FROM warehouse.tableaux AS t
    WHERE (t.proprietaire_id = ${contexte.userId} OR EXISTS (
      SELECT 1 FROM warehouse.lecteurs_tableaux AS l
      WHERE l.tableau_id = t.id AND l.utilisateur_id = ${contexte.userId}
    )) AND ${contient(Prisma.sql`t.definition ->> 'titre'`, q)}
    ORDER BY t.modifie_a DESC LIMIT ${MAX_PAR_TYPE}
  `
  return lignes.map(t => ({ type: 'tableau', id: t.id, titre: t.titre, href: `/tableaux/${t.id}` }))
}

async function analyses(contexte: ContexteExecution, q: string): Promise<ResultatRecherche[]> {
  // Mêmes artefacts que « Analyses » : enregistrés par l'utilisateur, ou partagés directement avec lui.
  // Titre et description sont ceux de la dernière version de la racine.
  const resultats: ResultatRecherche[] = []
  for (let page = 0; page < PAGES_ANALYSES_MAX && resultats.length < MAX_PAR_TYPE; page++) {
    const lignes = await prisma.$queryRaw<{ racine: string; titre: string; description: string | null }[]>`
      WITH visibles AS (
        SELECT "racineId" AS racine FROM assistant_artefacts WHERE "userId" = ${contexte.userId} AND enregistre = true
        UNION
        SELECT "ressourceId" AS racine FROM assistant_partages
        WHERE "aUserId" = ${contexte.userId} AND "ressourceType" = 'artefact'
      ), dernieres AS (
        SELECT DISTINCT ON (a."racineId") a."racineId" AS racine, a.titre, a.description, a."createdAt"
        FROM assistant_artefacts AS a JOIN visibles AS v ON v.racine = a."racineId"
        ORDER BY a."racineId", a.version DESC
      )
      SELECT racine, titre, description FROM dernieres
      WHERE ${contient(Prisma.sql`titre`, q)} OR ${contient(Prisma.sql`description`, q)}
      ORDER BY "createdAt" DESC, racine LIMIT ${TAILLE_PAGE_ANALYSES} OFFSET ${page * TAILLE_PAGE_ANALYSES}
    `
    for (const ligne of lignes) {
      if (resultats.length >= MAX_PAR_TYPE) break
      if (!(await ressourceDansPerimetre(contexte, 'artefact', ligne.racine))) continue
      resultats.push({
        type: 'analyse', id: ligne.racine, titre: ligne.titre,
        ...(ligne.description ? { detail: ligne.description.slice(0, 200) } : {}),
        href: `/assistant/analyses/${encodeURIComponent(ligne.racine)}`,
      })
    }
    if (lignes.length < TAILLE_PAGE_ANALYSES) break
  }
  return resultats
}

async function glossaire(contexte: ContexteExecution, q: string): Promise<ResultatRecherche[]> {
  const entrees = await listerGlossaire(contexte, { recherche: q })
  return entrees.slice(0, MAX_PAR_TYPE).map(e => ({
    type: 'glossaire', id: e.ancre, titre: e.indicateur.libelle, detail: e.jeu.libelle,
    href: `/glossaire#${encodeURIComponent(e.ancre)}`,
  }))
}

async function sources(contexte: ContexteExecution, q: string): Promise<ResultatRecherche[]> {
  if (contexte.roleName !== 'TenantAdmin') return []
  const lignes = await prisma.$queryRaw<{ id: string; titre: string }[]>`
    SELECT id, titre FROM warehouse.sources WHERE ${contient(Prisma.sql`titre`, q)} ORDER BY titre, id LIMIT ${MAX_PAR_TYPE}
  `
  return lignes.map(s => ({ type: 'source', id: s.id, titre: s.titre, href: `/sources/${encodeURIComponent(s.id)}` }))
}

/** Un type en échec ne casse pas la page : il est journalisé (sans la requête) et rendu vide. */
async function isole(type: TypeResultat, tache: Promise<ResultatRecherche[]>): Promise<ResultatRecherche[]> {
  try {
    return await tache
  } catch (erreur) {
    journal.erreur('Recherche globale partielle', { domaine: 'recherche', type, erreur: erreur instanceof Error ? erreur.name : 'inconnue' })
    return []
  }
}

/** Recherche globale : au plus 10 résultats par type, limités à ce que le contexte peut voir. */
export async function rechercher(contexte: ContexteExecution, q: string): Promise<ResultatRecherche[]> {
  const requete = requeteValide(q)
  if (!requete) return []
  const groupes = await Promise.all([
    isole('tableau', tableaux(contexte, requete)),
    isole('analyse', analyses(contexte, requete)),
    isole('glossaire', glossaire(contexte, requete)),
    isole('source', sources(contexte, requete)),
  ])
  return groupes.flat()
}
