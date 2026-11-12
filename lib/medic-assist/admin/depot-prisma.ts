/**
 * Acces Prisma de l'administration de Medic Assist. SEUL fichier de ce dossier qui touche
 * la base : les routes et les modules purs (usages.ts, avis.ts) n'importent jamais Prisma.
 * Client type (schema du lot 0) : aucun cast.
 */

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'

import type { AvisBrut, DonneesAvisBrutes, MessageBrut, QuestionBrute } from './avis'
import { CLES_PARAMETRES, type PersonneDto, type ValeurAvis } from './imports-lot0-lot1'
import { CLE_PARAMETRE_TAUX_EUR } from './types'
import { creerAccumulateurUsages, type LigneUsageGroupee } from './usages'

/** Taille des paquets lus pour l'agregation des usages. */
export const PAQUET_USAGES = 5_000
/** Plafond de messages utilisateur relus pour retrouver les questions d'une page d'avis. */
const PLAFOND_QUESTIONS = 5_000

// ---------------------------------------------------------------------------
// Taux EUR / USD et date de derniere mise a jour (ParametreApplication)
// ---------------------------------------------------------------------------

/** Taux saisi par l'administrateur, ou null s'il n'y en a pas (ou s'il est illisible). */
export async function lireTauxEurParUsdSaisi(): Promise<number | null> {
  const ligne = await prisma.parametreApplication.findUnique({
    where: { cle: CLE_PARAMETRE_TAUX_EUR },
  })
  if (!ligne) return null
  const taux = Number(ligne.valeur)
  return Number.isFinite(taux) && taux > 0 ? taux : null
}

export async function ecrireTauxEurParUsd(taux: number, userId: string): Promise<void> {
  await prisma.parametreApplication.upsert({
    where: { cle: CLE_PARAMETRE_TAUX_EUR },
    create: { cle: CLE_PARAMETRE_TAUX_EUR, valeur: String(taux), updatedBy: userId },
    update: { valeur: String(taux), updatedBy: userId },
  })
}

/** Derniere modification d'un reglage Medic Assist (config ou taux) et son auteur (NOM). */
export async function lireDerniereMiseAJour(): Promise<{
  majA: Date | null
  majPar: PersonneDto | null
}> {
  const ligne = await prisma.parametreApplication.findFirst({
    where: { cle: { in: [...Object.values(CLES_PARAMETRES), CLE_PARAMETRE_TAUX_EUR] } },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true, updatedBy: true },
  })
  if (!ligne) return { majA: null, majPar: null }
  if (!ligne.updatedBy) return { majA: ligne.updatedAt, majPar: null }
  const noms = await lireNomsUtilisateurs([ligne.updatedBy])
  const nom = noms.get(ligne.updatedBy)
  return { majA: ligne.updatedAt, majPar: nom ? { id: ligne.updatedBy, nom } : null }
}

// ---------------------------------------------------------------------------
// Utilisateurs
// ---------------------------------------------------------------------------

/** Nom complet, repli sur l'e-mail, repli final sur null (le dernier cas est rare). */
export function nomAffiche(u: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}) {
  const nom = [u.firstName, u.lastName]
    .map(x => (x ?? '').trim())
    .filter(Boolean)
    .join(' ')
  return nom || (u.email ?? '').trim() || null
}

export async function lireNomsUtilisateurs(ids: string[]): Promise<Map<string, string>> {
  const noms = new Map<string, string>()
  const uniques = [...new Set(ids)]
  for (let i = 0; i < uniques.length; i += 500) {
    const lignes = await prisma.user.findMany({
      where: { id: { in: uniques.slice(i, i + 500) } },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
    for (const l of lignes) {
      const nom = nomAffiche(l)
      if (nom) noms.set(l.id, nom)
    }
  }
  return noms
}

// ---------------------------------------------------------------------------
// Usages
// ---------------------------------------------------------------------------

export interface FiltreUsages {
  depuis: Date
  avant: Date
  utilisateurId?: string
  fournisseur?: string
  modele?: string
  mode?: string
}

/**
 * Lit les usages filtres de [depuis, avant) par paquets (curseur sur l'id) et les regroupe a
 * la volee par (jour Paris, utilisateur, mode, fournisseur, modele) : la memoire reste
 * proportionnelle au nombre de groupes, jamais au nombre d'appels.
 */
export async function lireUsagesGroupes(filtre: FiltreUsages): Promise<LigneUsageGroupee[]> {
  const where: Prisma.AssistantUsageWhereInput = {
    createdAt: { gte: filtre.depuis, lt: filtre.avant },
    ...(filtre.utilisateurId ? { userId: filtre.utilisateurId } : {}),
    ...(filtre.fournisseur ? { fournisseur: filtre.fournisseur } : {}),
    ...(filtre.modele ? { modele: filtre.modele } : {}),
    ...(filtre.mode ? { mode: filtre.mode } : {}),
  }
  const acc = creerAccumulateurUsages()
  let curseur: string | undefined
  for (;;) {
    const lot = await prisma.assistantUsage.findMany({
      where,
      select: {
        id: true,
        userId: true,
        mode: true,
        fournisseur: true,
        modele: true,
        tokensEntree: true,
        tokensSortie: true,
        tokensCacheLecture: true,
        tokensCacheEcriture: true,
        coutUsd: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
      take: PAQUET_USAGES,
      ...(curseur ? { cursor: { id: curseur }, skip: 1 } : {}),
    })
    if (lot.length === 0) break
    acc.ajouter(
      lot.map(l => ({
        createdAt: l.createdAt,
        userId: l.userId,
        mode: l.mode,
        fournisseur: l.fournisseur,
        modele: l.modele,
        tokensEntree: l.tokensEntree,
        tokensSortie: l.tokensSortie,
        tokensCacheLecture: l.tokensCacheLecture,
        tokensCacheEcriture: l.tokensCacheEcriture,
        coutUsd: l.coutUsd.toNumber(),
      }))
    )
    if (lot.length < PAQUET_USAGES) break
    curseur = lot[lot.length - 1].id
  }
  return acc.groupes()
}

// ---------------------------------------------------------------------------
// Avis (lecture seule, requetes groupees : pas de N+1)
// ---------------------------------------------------------------------------

export interface DemandeAvis {
  valeur?: ValeurAvis
  depuis?: Date
  avant?: Date
  curseur?: string
  taille: number
}

const filtreNote = (valeur: ValeurAvis | undefined): Prisma.AssistantAvisWhereInput =>
  valeur === 'positif' ? { note: { gt: 0 } } : valeur === 'negatif' ? { note: { lt: 0 } } : {}

const filtreDates = (
  demande: Pick<DemandeAvis, 'depuis' | 'avant'>
): Prisma.AssistantAvisWhereInput =>
  demande.depuis || demande.avant
    ? {
        createdAt: {
          ...(demande.depuis ? { gte: demande.depuis } : {}),
          ...(demande.avant ? { lt: demande.avant } : {}),
        },
      }
    : {}

/** Comptes de la periode, sans le filtre de valeur (les deux onglets restent chiffres). */
export async function compterAvis(
  demande: Pick<DemandeAvis, 'depuis' | 'avant'>
): Promise<{ positifs: number; negatifs: number }> {
  const dates = filtreDates(demande)
  const [positifs, negatifs] = await Promise.all([
    prisma.assistantAvis.count({ where: { ...dates, ...filtreNote('positif') } }),
    prisma.assistantAvis.count({ where: { ...dates, ...filtreNote('negatif') } }),
  ])
  return { positifs, negatifs }
}

/**
 * Une page d'avis (taille + 1 lignes pour savoir s'il y en a une suivante), avec les messages
 * notes, les messages utilisateur des conversations concernees et les auteurs : quatre
 * requetes en plus de la page, quelle que soit sa taille.
 */
export async function lireAvisBruts(demande: DemandeAvis): Promise<DonneesAvisBrutes> {
  const lignes = await prisma.assistantAvis.findMany({
    where: { ...filtreDates(demande), ...filtreNote(demande.valeur) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: demande.taille + 1,
    ...(demande.curseur ? { cursor: { id: demande.curseur } } : {}),
  })
  const avis: AvisBrut[] = lignes.map(a => ({
    id: a.id,
    messageId: a.messageId,
    userId: a.userId,
    note: a.note,
    commentaire: a.commentaire,
    createdAt: a.createdAt,
  }))

  const messageIds = [...new Set(avis.map(a => a.messageId))]
  const messages: MessageBrut[] = messageIds.length
    ? await prisma.assistantMessage.findMany({
        where: { id: { in: messageIds } },
        select: {
          id: true,
          conversationId: true,
          parts: true,
          metadonnees: true,
          createdAt: true,
        },
      })
    : []

  const conversationIds = [...new Set(messages.map(m => m.conversationId))]
  const plusRecente = messages.reduce<Date | null>(
    (max, m) => (max === null || m.createdAt > max ? m.createdAt : max),
    null
  )
  const questions: QuestionBrute[] =
    conversationIds.length && plusRecente
      ? await prisma.assistantMessage.findMany({
          where: {
            conversationId: { in: conversationIds },
            role: 'user',
            createdAt: { lte: plusRecente },
          },
          select: { conversationId: true, parts: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: PLAFOND_QUESTIONS,
        })
      : []

  const auteurs = await lireNomsUtilisateurs(avis.map(a => a.userId))
  return { avis, messages, questions, auteurs }
}
