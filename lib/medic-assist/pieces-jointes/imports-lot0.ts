/**
 * Point UNIQUE d'import des contrats du lot 0 pour les pieces jointes.
 *
 * - types et constantes : '@/lib/medic-assist/contrats' (aucun import serveur, charge sans cout) ;
 * - jeu de donnees      : 'enregistrerJeuDeDonnees' du lot 2 (lib/medic-assist/donnees/outils) ;
 * - garde des routes    : importee directement depuis '@/lib/medic-assist/acces' par les routes
 *   (elle tire next-auth et Prisma : on ne la reexporte pas ici pour garder ce fichier leger).
 */

export { CHAMPS_TELEVERSEMENT, LIMITES } from '@/lib/medic-assist/contrats'
export type {
  Cellule,
  CodeErreurOutil,
  ColonneJeu,
  ContenuPieceJointe,
  ContexteExecution,
  EntreeLirePieceJointe,
  ErreurOutil,
  LigneJeu,
  PieceJointeDto,
  Provenance,
  ResultatJeu,
  TypeColonne,
} from '@/lib/medic-assist/contrats'

import type {
  ColonneJeu,
  ContexteExecution,
  Provenance,
  ResultatJeu,
} from '@/lib/medic-assist/contrats'

/** Reference rejouable d'un jeu issu d'une piece jointe (champ `requete` du lot 2). */
export interface RequetePieceJointe {
  pieceJointeId: string
  feuille: string
  plage?: string
}

/** Signature de `enregistrerJeuDeDonnees` (lot 2), injectable dans les tests. */
export type EnregistrerJeuDeDonnees = (
  contexte: ContexteExecution,
  donnees: {
    source: 'piece_jointe'
    requete: RequetePieceJointe
    colonnes: ColonneJeu[]
    lignes: Record<string, unknown>[]
    provenance: Provenance
  }
) => Promise<ResultatJeu>
