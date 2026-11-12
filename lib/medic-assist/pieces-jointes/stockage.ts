/**
 * Stockage des pieces jointes de Medic Assist sur disque.
 *
 * S'appuie sur FileUploadService (nom, taille, signature, nom stocke) mais :
 *   - restreint la liste blanche a LIMITES.extensionsPiecesJointes, controlee AVANT
 *     de deleguer (le service accepte aussi docx, png...) ;
 *   - ecrit dans un sous-dossier dedie : <depot>/medic-assist ;
 *   - refuse l'ancien format .xls (OLE), qu'aucune bibliotheque installee ne lit.
 */

import { existsSync } from 'fs'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'

import { FileUploadService } from '@/lib/utils/file-upload'

import { ErreurPieceJointe } from './erreurs'
import { LIMITES } from './imports-lot0'

export type ExtensionPieceJointe = 'xlsx' | 'csv' | 'pdf' | 'txt'

const EXTENSIONS_ACCEPTEES: readonly string[] = LIMITES.extensionsPiecesJointes

/** Extension en minuscules d'un nom de fichier, '' s'il n'y en a pas. */
export function extensionDe(nom: string): string {
  const point = nom.lastIndexOf('.')
  return point >= 0 ? nom.slice(point + 1).toLowerCase() : ''
}

/** Types MIME fixes par extension : le type declare par le client n est jamais conserve. */
export const TYPES_MIME: Record<ExtensionPieceJointe, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  pdf: 'application/pdf',
  txt: 'text/plain',
}

/** Dossier dedie aux pieces jointes (non cree ici). */
export function dossierPiecesJointes(): string {
  return join(FileUploadService.repertoireDepot(), 'medic-assist')
}

/**
 * Chemin de `nomStocke` dans le dossier dedie, ou null s'il en sortirait. Le nom est
 * genere par le service ; on le re-verifie ici contre le dossier resolu.
 */
export function cheminStocke(nomStocke: string): string | null {
  if (!FileUploadService.isStoredFilename(nomStocke)) return null
  const base = resolve(dossierPiecesJointes())
  const chemin = resolve(base, nomStocke)
  return chemin.startsWith(base + sep) ? chemin : null
}

/**
 * Controle un envoi : extension (liste blanche restreinte), taille, nom, signature.
 * Rend l'extension validee ; leve ErreurPieceJointe sinon.
 */
export function validerFichier(nom: string, octets: Uint8Array): ExtensionPieceJointe {
  const extension = extensionDe(nom)
  if (extension === 'xls') throw new ErreurPieceJointe('formatXlsNonPrisEnCharge')
  if (!EXTENSIONS_ACCEPTEES.includes(extension)) throw new ErreurPieceJointe('extensionRefusee')

  if (octets.byteLength > LIMITES.tailleMaxPieceJointeOctets) {
    throw new ErreurPieceJointe('fichierTropGros')
  }

  // validateFile ne lit que name et size : pas besoin d'un vrai File.
  const controle = FileUploadService.validateFile({ name: nom, size: octets.byteLength } as File)
  if (!controle.valid) {
    if (controle.error === 'Empty file') throw new ErreurPieceJointe('fichierVide')
    if (controle.error?.startsWith('File size')) throw new ErreurPieceJointe('fichierTropGros')
    if (controle.error === 'Invalid filename') throw new ErreurPieceJointe('nomInvalide')
    throw new ErreurPieceJointe('extensionRefusee')
  }

  const contenu = FileUploadService.validateContent(nom, octets)
  if (!contenu.valid) throw new ErreurPieceJointe('signatureIncoherente')

  return extension as ExtensionPieceJointe
}

export interface FichierStocke {
  nomStocke: string
  extension: ExtensionPieceJointe
  tailleOctets: number
}

/** Valide puis ecrit le fichier. Le nom d'origine ne sert jamais de chemin. */
export async function stockerFichier(nomOriginal: string, octets: Buffer): Promise<FichierStocke> {
  const extension = validerFichier(nomOriginal, octets)

  const nomStocke = FileUploadService.generateUniqueFilename(nomOriginal)
  const chemin = cheminStocke(nomStocke)
  if (!chemin) throw new ErreurPieceJointe('nomInvalide')

  await mkdir(dossierPiecesJointes(), { recursive: true })
  await writeFile(chemin, octets)
  return { nomStocke, extension, tailleOctets: octets.byteLength }
}

/** Contenu du fichier stocke, ou null si le nom est invalide ou le fichier absent. */
export async function lireFichierStocke(nomStocke: string): Promise<Buffer | null> {
  const chemin = cheminStocke(nomStocke)
  if (!chemin || !existsSync(chemin)) return null
  return readFile(chemin)
}

/** Supprime le fichier stocke ; sans effet s'il n'existe pas. */
export async function supprimerFichierStocke(nomStocke: string): Promise<void> {
  const chemin = cheminStocke(nomStocke)
  if (!chemin || !existsSync(chemin)) return
  try {
    await unlink(chemin)
  } catch (erreur) {
    console.error(
      'Medic Assist : suppression du fichier impossible',
      (erreur as NodeJS.ErrnoException).code
    )
  }
}
