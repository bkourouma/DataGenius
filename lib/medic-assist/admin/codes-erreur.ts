/**
 * Codes d'erreur stables des routes du lot 6 (champ `error` des reponses
 * { error, message }). Le serveur ne renvoie que ces CODES (le `message` anglais
 * court est un repli) : l'interface les traduit avec la cle
 * `medicAssistAdmin.erreursApi.<code>` (6 langues). Un test verifie que chaque code
 * a sa traduction.
 */

export const CODES_ERREUR_LOT_6 = [
  // communs
  'validationInvalide',
  'erreurServeur',
  'aucunChamp',
  // administration
  'fournisseurIndisponible',
  'periodeInvalide',
  // pieces jointes
  'fichierAbsent',
  'fichierTropGros',
  'fichierTropVolumineuxDecompresse',
  'extensionRefusee',
  'formatXlsNonPrisEnCharge',
  'nomInvalide',
  'fichierVide',
  'signatureIncoherente',
  'classeurIllisible',
  'classeurProtege',
  'pdfSansTexte',
  'pdfProtege',
  'pdfIllisible',
  'pdfNonDisponible',
  'csvIllisible',
  'conversationIntrouvable',
  'pieceJointeIntrouvable',
  'feuilleIntrouvable',
  'plageInvalide',
  'fichierStockeIntrouvable',
  'quota_pieces_jointes',
  // transcription
  'transcriptionIndisponible',
  'transcriptionEchec',
  'audioAbsent',
  'audioTropGros',
  'audioFormatRefuse',
  'audioVide',
  // donnees (lot 2) : GET /api/medic-assist/jeux/[id] et /api/medic-assist/briefing
  'jeuIntrouvable',
  'accesRefuse',
  'jeuNonRecalculable',
  'limite_debit_donnees',
  'roleLectureAbsent',
  'briefingIndisponible',
] as const
export type CodeErreurLot6 = (typeof CODES_ERREUR_LOT_6)[number]
