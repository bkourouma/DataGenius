/**
 * Erreurs typees des pieces jointes.
 *
 * Le SERVEUR ne renvoie que des CODES stables : le `message` est un repli anglais court,
 * jamais affiche tel quel, l'interface traduit `medicAssistAdmin.erreursApi.<code>`.
 * Aucun message ne contient de chemin, de nom stocke ni de detail technique.
 *
 * Cote agent (lot 1) : `lirePieceJointe` LEVE ErreurPieceJointe ; le lot 1 la convertit en
 * resultat d'outil avec `versErreurOutil`.
 */

import type { CodeErreurOutil, ErreurOutil } from './dependances'

export type CodeErreurPieceJointe =
  | 'fichierAbsent'
  | 'extensionRefusee'
  | 'formatXlsNonPrisEnCharge'
  | 'nomInvalide'
  | 'fichierVide'
  | 'signatureIncoherente'
  | 'fichierTropGros'
  | 'fichierTropVolumineuxDecompresse'
  | 'classeurIllisible'
  | 'classeurProtege'
  | 'csvIllisible'
  | 'pdfSansTexte'
  | 'pdfProtege'
  | 'pdfIllisible'
  | 'pdfNonDisponible'
  | 'pieceJointeIntrouvable'
  | 'fichierStockeIntrouvable'
  | 'conversationIntrouvable'
  | 'feuilleIntrouvable'
  | 'plageInvalide'
  | 'quota_pieces_jointes'

const STATUTS: Record<CodeErreurPieceJointe, number> = {
  fichierAbsent: 400,
  extensionRefusee: 400,
  formatXlsNonPrisEnCharge: 400,
  nomInvalide: 400,
  fichierVide: 400,
  signatureIncoherente: 400,
  fichierTropGros: 413,
  fichierTropVolumineuxDecompresse: 422,
  classeurIllisible: 422,
  classeurProtege: 422,
  csvIllisible: 422,
  pdfSansTexte: 422,
  pdfProtege: 422,
  pdfIllisible: 422,
  pdfNonDisponible: 500,
  pieceJointeIntrouvable: 404,
  fichierStockeIntrouvable: 404,
  conversationIntrouvable: 404,
  feuilleIntrouvable: 404,
  plageInvalide: 400,
  quota_pieces_jointes: 413,
}

/** Replis anglais courts (le client affiche la traduction du code). */
const MESSAGES_REPLI: Record<CodeErreurPieceJointe, string> = {
  fichierAbsent: 'No file received.',
  extensionRefusee: 'Unsupported format. Accepted: xlsx, csv, pdf, txt.',
  formatXlsNonPrisEnCharge: 'The legacy .xls format is not supported. Save the workbook as .xlsx.',
  nomInvalide: 'Invalid file name.',
  fichierVide: 'The file is empty.',
  signatureIncoherente: 'The file content does not match its extension.',
  fichierTropGros: 'The file exceeds the 10 MB limit.',
  fichierTropVolumineuxDecompresse: 'The workbook is too large once decompressed.',
  classeurIllisible: 'The Excel workbook is unreadable or corrupted.',
  classeurProtege: 'The Excel workbook is password-protected.',
  csvIllisible: 'The CSV file is unreadable.',
  pdfSansTexte: 'This PDF has no selectable text (scanned document); OCR is not supported.',
  pdfProtege: 'The PDF is password-protected.',
  pdfIllisible: 'The PDF is unreadable or corrupted.',
  pdfNonDisponible: 'PDF reading is not available on this server.',
  pieceJointeIntrouvable: 'Attachment not found.',
  fichierStockeIntrouvable: 'The attachment file is missing.',
  conversationIntrouvable: 'Conversation not found.',
  feuilleIntrouvable: 'Sheet not found.',
  plageInvalide: 'Invalid range.',
  quota_pieces_jointes: 'Attachment quota reached (100 files or 200 MB per user).',
}

export class ErreurPieceJointe extends Error {
  readonly code: CodeErreurPieceJointe
  readonly statut: number

  /**
   * `message` facultatif : precision destinee au MODELE (ex. feuilles disponibles), en anglais,
   * sans chemin. Le client, lui, n'affiche que la traduction du code.
   */
  constructor(code: CodeErreurPieceJointe, message?: string) {
    super(message ?? MESSAGES_REPLI[code])
    this.name = 'ErreurPieceJointe'
    this.code = code
    this.statut = STATUTS[code]
  }
}

/** Erreur de lecture du contenu d'un fichier (toujours 422, ou 500 si l'extracteur manque). */
export class ExtractionError extends ErreurPieceJointe {
  constructor(code: CodeErreurPieceJointe, message?: string) {
    super(code, message)
    this.name = 'ExtractionError'
  }
}

const CODE_OUTIL: Record<CodeErreurPieceJointe, CodeErreurOutil> = {
  fichierAbsent: 'piece_jointe_illisible',
  extensionRefusee: 'piece_jointe_illisible',
  formatXlsNonPrisEnCharge: 'piece_jointe_illisible',
  nomInvalide: 'piece_jointe_illisible',
  fichierVide: 'piece_jointe_illisible',
  signatureIncoherente: 'piece_jointe_illisible',
  fichierTropGros: 'piece_jointe_illisible',
  fichierTropVolumineuxDecompresse: 'piece_jointe_illisible',
  classeurIllisible: 'piece_jointe_illisible',
  classeurProtege: 'piece_jointe_illisible',
  csvIllisible: 'piece_jointe_illisible',
  pdfSansTexte: 'piece_jointe_illisible',
  pdfProtege: 'piece_jointe_illisible',
  pdfIllisible: 'piece_jointe_illisible',
  pdfNonDisponible: 'interne',
  pieceJointeIntrouvable: 'introuvable',
  fichierStockeIntrouvable: 'introuvable',
  conversationIntrouvable: 'introuvable',
  feuilleIntrouvable: 'introuvable',
  plageInvalide: 'entree_invalide',
  quota_pieces_jointes: 'piece_jointe_illisible',
}

/** Resultat d'outil pour l'agent (contrats/outils.ts) : le modele peut corriger sa demande. */
export function versErreurOutil(erreur: ErreurPieceJointe): ErreurOutil {
  return { erreur: { code: CODE_OUTIL[erreur.code], message: erreur.message } }
}
