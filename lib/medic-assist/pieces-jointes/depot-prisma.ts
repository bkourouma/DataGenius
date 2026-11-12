/**
 * Acces Prisma aux pieces jointes : SEUL fichier du lot qui touche la base.
 *
 * Modele reel `AssistantPieceJointe` : id, userId, conversationId?, nomFichier, typeMime,
 * taille, chemin (relatif au dossier dedie), contenu (Json? : RESUME seulement, jamais le
 * contenu complet), createdAt. Toute lecture ou suppression par id met `userId` dans le MEME
 * `where`.
 */

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'

import type { ResumePieceJointe } from './types'

export interface LignePieceJointe {
  id: string
  userId: string
  conversationId: string | null
  nomFichier: string
  typeMime: string
  taille: number
  /** Chemin RELATIF au dossier dedie (jamais renvoye au client). */
  chemin: string
  /** Resume de l'extraction ; null si la ligne n'en porte pas (ou un JSON inattendu). */
  resume: ResumePieceJointe | null
  createdAt: Date
}

export interface DonneesCreationPieceJointe {
  userId: string
  conversationId: string | null
  nomFichier: string
  typeMime: string
  taille: number
  chemin: string
  resume: ResumePieceJointe
}

/** Ce que le service attend du depot (injectable dans les tests). */
export interface DepotPiecesJointes {
  creer(donnees: DonneesCreationPieceJointe): Promise<LignePieceJointe>
  /** Proprietaire dans le MEME where que l'id. */
  lireDuProprietaire(id: string, userId: string): Promise<LignePieceJointe | null>
  /** Rend le nombre de lignes supprimees (0 si la piece n'est pas au demandeur). */
  supprimerDuProprietaire(id: string, userId: string): Promise<number>
  /** Vrai si la conversation existe ET appartient a l'utilisateur. */
  conversationDuProprietaire(id: string, userId: string): Promise<boolean>
}

/** Relit le JSON `contenu` ; tout ce qui n'a pas la forme d'un resume devient null. */
export function lireResume(valeur: Prisma.JsonValue | null): ResumePieceJointe | null {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) return null
  const { type } = valeur
  if (type !== 'tableau' && type !== 'texte') return null
  return valeur as ResumePieceJointe
}

interface LigneBase {
  id: string
  userId: string
  conversationId: string | null
  nomFichier: string
  typeMime: string
  taille: number
  chemin: string
  contenu: Prisma.JsonValue | null
  createdAt: Date
}

function versLigne(ligne: LigneBase): LignePieceJointe {
  const { contenu, ...reste } = ligne
  return { ...reste, resume: lireResume(contenu) }
}

export const depotPrisma: DepotPiecesJointes = {
  async creer({ resume, ...donnees }) {
    const ligne = await prisma.assistantPieceJointe.create({
      data: { ...donnees, contenu: resume },
    })
    return versLigne(ligne)
  },

  async lireDuProprietaire(id, userId) {
    const ligne = await prisma.assistantPieceJointe.findFirst({ where: { id, userId } })
    return ligne ? versLigne(ligne) : null
  },

  async supprimerDuProprietaire(id, userId) {
    const { count } = await prisma.assistantPieceJointe.deleteMany({ where: { id, userId } })
    return count
  },

  async conversationDuProprietaire(id, userId) {
    const ligne = await prisma.assistantConversation.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    return ligne !== null
  },
}
