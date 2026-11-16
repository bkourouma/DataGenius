import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import {
  EXPORT_MAX_LIGNES, TAILLE_PAGE_AUDIT,
  type FiltresAudit, type LigneAudit, type ResultatAudit,
} from './types'

export interface PageAudit { lignes: LigneAudit[]; total: number; page: number; pages: number }

const MS_PAR_JOUR = 86_400_000
/** Les modifications de droits (table warehouse.audit_acces) sont reprises sur la même durée que le journal. */
const JOURS_DROITS = 365

interface LigneBrute {
  id: string
  fait_a: Date
  acteur_id: string | null
  acteur_nom: string | null
  action: string
  cible_type: string | null
  cible_id: string | null
  cible_libelle: string | null
  resultat: string
  details: unknown
  ip: string | null
}

/** Échappe `\`, `%` et `_` pour un motif ILIKE (échappement par défaut de PostgreSQL : `\`). */
function echapperLike(texte: string): string {
  return texte.replace(/[\\%_]/g, '\\$&')
}

/**
 * `jusqua` est INCLUSIF. Le front transmet une date (minuit UTC) : dans ce cas on couvre toute la
 * journée (borne exclusive = lendemain minuit). Un instant précis (non minuit UTC) est une borne
 * inclusive exacte.
 */
function borneSuperieure(jusqua: Date): Prisma.Sql {
  if (jusqua.getTime() % MS_PAR_JOUR === 0) {
    return Prisma.sql`fait_a < ${new Date(jusqua.getTime() + MS_PAR_JOUR)}::timestamptz`
  }
  return Prisma.sql`fait_a <= ${jusqua}::timestamptz`
}

function conditions(filtres: FiltresAudit): Prisma.Sql {
  const liste: Prisma.Sql[] = []
  if (filtres.depuis) liste.push(Prisma.sql`fait_a >= ${filtres.depuis}::timestamptz`)
  if (filtres.jusqua) liste.push(borneSuperieure(filtres.jusqua))
  const acteur = filtres.acteur?.trim()
  if (acteur) {
    const motif = `%${echapperLike(acteur)}%`
    liste.push(Prisma.sql`(acteur_id = ${acteur} OR email ILIKE ${motif} OR prenom ILIKE ${motif} OR nom ILIKE ${motif})`)
  }
  if (filtres.famille) liste.push(Prisma.sql`action LIKE ${filtres.famille + '.%'}`)
  if (filtres.action) liste.push(Prisma.sql`action = ${filtres.action}`)
  const cible = filtres.cible?.trim()
  if (cible) {
    liste.push(Prisma.sql`(cible_id = ${cible} OR cible_libelle ILIKE ${`%${echapperLike(cible)}%`})`)
  }
  return liste.length > 0 ? Prisma.sql`WHERE ${Prisma.join(liste, ' AND ')}` : Prisma.empty
}

/** Journal + modifications de droits, enrichis du nom de l'acteur, filtrés. Tri : plus récent d'abord. */
function requete(filtres: FiltresAudit, fin: Prisma.Sql, colonnes: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH source AS (
      SELECT 'j' || id::text AS id, fait_a, acteur_id, action, cible_type, cible_id, cible_libelle,
             resultat, details, ip
      FROM warehouse.journal_audit
      UNION ALL
      SELECT 'a' || id::text, fait_a, acteur_id, 'droits.modification'::text, 'droits'::text, objet,
             NULL::text, 'succes'::text, jsonb_build_object('operation', action), NULL::text
      FROM warehouse.audit_acces
      WHERE fait_a >= now() - make_interval(days => ${JOURS_DROITS}::int)
    ),
    enrichi AS (
      SELECT s.*, u.email, u."firstName" AS prenom, u."lastName" AS nom,
             COALESCE(NULLIF(trim(concat_ws(' ', u."firstName", u."lastName")), ''), u.email) AS acteur_nom
      FROM source s
      LEFT JOIN public.users u ON u.id = s.acteur_id
    )
    SELECT ${colonnes} FROM enrichi ${conditions(filtres)} ${fin}`
}

const COLONNES_LIGNE = Prisma.sql`id, fait_a, acteur_id, acteur_nom, action, cible_type, cible_id, cible_libelle, resultat, details, ip`
const TRI = Prisma.sql`ORDER BY fait_a DESC, id DESC`

function versLigne(brute: LigneBrute): LigneAudit {
  const details = brute.details
  return {
    id: brute.id,
    faitA: brute.fait_a,
    acteurId: brute.acteur_id,
    acteurNom: brute.acteur_nom,
    action: brute.action,
    cibleType: brute.cible_type,
    cibleId: brute.cible_id,
    cibleLibelle: brute.cible_libelle,
    resultat: brute.resultat as ResultatAudit,
    details: details && typeof details === 'object' && !Array.isArray(details) ? details as Record<string, unknown> : {},
    ip: brute.ip,
  }
}

export async function listerAudit(filtres: FiltresAudit, page: number): Promise<PageAudit> {
  const comptes = await prisma.$queryRaw<{ total: number }[]>(requete(filtres, Prisma.empty, Prisma.sql`count(*)::int AS total`))
  const total = comptes[0]?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / TAILLE_PAGE_AUDIT))
  const demandee = Number.isFinite(page) ? Math.trunc(page) : 1
  const courante = Math.min(Math.max(1, demandee), pages)
  const brutes = await prisma.$queryRaw<LigneBrute[]>(
    requete(filtres, Prisma.sql`${TRI} LIMIT ${TAILLE_PAGE_AUDIT} OFFSET ${(courante - 1) * TAILLE_PAGE_AUDIT}`, COLONNES_LIGNE),
  )
  return { lignes: brutes.map(versLigne), total, page: courante, pages }
}

export async function lireAuditPourExport(filtres: FiltresAudit): Promise<{ lignes: LigneAudit[]; tronque: boolean }> {
  // Une ligne de plus que le maximum pour savoir s'il y en avait davantage.
  const brutes = await prisma.$queryRaw<LigneBrute[]>(
    requete(filtres, Prisma.sql`${TRI} LIMIT ${EXPORT_MAX_LIGNES + 1}`, COLONNES_LIGNE),
  )
  return { lignes: brutes.slice(0, EXPORT_MAX_LIGNES).map(versLigne), tronque: brutes.length > EXPORT_MAX_LIGNES }
}
