/**
 * Service des pieces jointes : envoi (validation, stockage, verification de lecture,
 * enregistrement), metadonnees et suppression. Le proprietaire est toujours dans le meme
 * `where` que l'id (voir depot-prisma.ts). Les reponses sont des PieceJointeDto : ni le chemin
 * stocke ni aucun nom de fichier du serveur n'en sortent.
 */

import { ErreurPieceJointe } from './erreurs'
import { extraireContenu } from './extraction'
import type { ContexteExecution, PieceJointeDto } from './imports-lot0'
import { depotPrisma, type DepotPiecesJointes, type LignePieceJointe } from './depot-prisma'
import {
  extensionDe,
  stockerFichier,
  supprimerFichierStocke,
  TYPES_MIME,
  validerFichier,
  type ExtensionPieceJointe,
} from './stockage'
import {
  PLAFONDS,
  type ContenuExtrait,
  type DependancesExtraction,
  type ResumePieceJointe,
} from './types'

export interface FichierEnvoye {
  nom: string
  octets: Buffer
}

export interface DependancesService extends DependancesExtraction {
  depot?: DepotPiecesJointes
}

/** Resume garde en base : formes et libelles de colonnes, jamais les lignes. */
export function resumerContenu(contenu: ContenuExtrait): ResumePieceJointe {
  if (contenu.type === 'tableau') {
    return {
      type: 'tableau',
      nbFeuilles: contenu.nbFeuilles,
      tronque: contenu.feuilles.some(f => f.tronque),
      feuilles: contenu.feuilles.map(f => ({
        nom: f.nom,
        nbLignes: f.nbLignesVues,
        nbColonnes: f.colonnes.length,
        colonnes: f.colonnes.slice(0, PLAFONDS.colonnesResume).map(c => c.libelle),
        tronque: f.tronque,
      })),
    }
  }
  return { type: 'texte', nbPages: contenu.nbPages, tronque: contenu.tronque }
}

/** Ligne de base -> DTO de l'API (extension tiree du nom, feuilles et pages du resume). */
export function versPieceJointeDto(ligne: LignePieceJointe): PieceJointeDto {
  const extension = extensionDe(ligne.nomFichier) as ExtensionPieceJointe
  return {
    id: ligne.id,
    nom: ligne.nomFichier,
    extension,
    tailleOctets: ligne.taille,
    typeMime: ligne.typeMime,
    conversationId: ligne.conversationId,
    ...(ligne.resume?.feuilles ? { feuilles: ligne.resume.feuilles.map(f => f.nom) } : {}),
    ...(ligne.resume?.type === 'texte' && extension === 'pdf' && ligne.resume.nbPages
      ? { pages: ligne.resume.nbPages }
      : {}),
    creeA: ligne.createdAt.toISOString(),
  }
}

/**
 * Valide, stocke, verifie que le fichier se lit, puis enregistre. Si le fichier est illisible
 * (ou si l'enregistrement echoue), il est supprime du disque.
 */
export async function enregistrerPieceJointe(
  contexte: ContexteExecution,
  fichier: FichierEnvoye,
  options: { conversationId?: string | null } = {},
  deps: DependancesService = {}
): Promise<PieceJointeDto> {
  const depot = deps.depot ?? depotPrisma

  // Controles avant tout acces au disque ou a la base.
  validerFichier(fichier.nom, fichier.octets)

  const conversationId = options.conversationId ?? null
  if (
    conversationId &&
    !(await depot.conversationDuProprietaire(conversationId, contexte.userId))
  ) {
    throw new ErreurPieceJointe('conversationIntrouvable')
  }

  const stocke = await stockerFichier(fichier.nom, fichier.octets)
  try {
    const contenu = await extraireContenu(stocke.extension, fichier.octets, {
      extrairePdf: deps.extrairePdf,
      nomFichier: fichier.nom,
    })
    const ligne = await depot.creer({
      userId: contexte.userId,
      conversationId,
      nomFichier: fichier.nom,
      typeMime: TYPES_MIME[stocke.extension],
      taille: stocke.tailleOctets,
      chemin: stocke.nomStocke,
      resume: resumerContenu(contenu),
    })
    return versPieceJointeDto(ligne)
  } catch (erreur) {
    await supprimerFichierStocke(stocke.nomStocke)
    throw erreur
  }
}

/** Metadonnees d'une piece jointe du demandeur ; null si elle n'est pas a lui. */
export async function lireMetadonnees(
  contexte: ContexteExecution,
  id: string,
  deps: DependancesService = {}
): Promise<PieceJointeDto | null> {
  const ligne = await (deps.depot ?? depotPrisma).lireDuProprietaire(id, contexte.userId)
  return ligne ? versPieceJointeDto(ligne) : null
}

/** Supprime la ligne puis le fichier ; rend false si la piece n'est pas au demandeur. */
export async function supprimerPieceJointe(
  contexte: Pick<ContexteExecution, 'userId'>,
  id: string,
  deps: DependancesService = {}
): Promise<boolean> {
  const depot = deps.depot ?? depotPrisma
  const ligne = await depot.lireDuProprietaire(id, contexte.userId)
  if (!ligne) return false
  const supprimees = await depot.supprimerDuProprietaire(id, contexte.userId)
  if (supprimees === 0) return false
  await supprimerFichierStocke(ligne.chemin)
  return true
}
