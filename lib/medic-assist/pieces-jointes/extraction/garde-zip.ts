/**
 * Garde anti-bombe ZIP, executee AVANT exceljs sur un .xlsx (un .xlsx est un zip).
 *
 * `JSZip.loadAsync` ne lit que le repertoire central : aucune entree n'est decompressee ici.
 * On additionne les tailles decompressees DECLAREES et on refuse au-dela des plafonds. Une taille
 * declaree trop basse ne passe pas la decompression : JSZip controle la longueur reelle.
 */

import JSZip from 'jszip'

import { ExtractionError } from '../erreurs'

export const PLAFONDS_ZIP = {
  totalOctets: 100 * 1024 * 1024,
  fichierOctets: 50 * 1024 * 1024,
} as const

/** Partie interne de JSZip que l'on lit (non typee dans les definitions publiques). */
interface EntreeInterne {
  _data?: { uncompressedSize?: number }
}

/**
 * Leve ExtractionError('fichierTropVolumineuxDecompresse') si le zip declare plus de 100 Mo
 * decompresses au total, plus de 50 Mo pour un seul fichier, ou si la taille d'une entree
 * est inconnue. Une archive illisible leve
 * l'erreur `erreurLecture` fournie par l'appelant.
 */
export async function verifierTailleDecompressee(
  octets: Uint8Array,
  erreurLecture: (cause: unknown) => ExtractionError
): Promise<void> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(octets)
  } catch (cause) {
    throw erreurLecture(cause)
  }

  let total = 0
  let trop = false
  zip.forEach((_chemin, entree) => {
    if (entree.dir) return
    const taille = (entree as unknown as EntreeInterne)._data?.uncompressedSize
    // Taille inconnue (champ interne de JSZip absent, version changee) : on ne peut pas
    // garantir le plafond, donc on refuse plutot que de laisser passer.
    if (typeof taille !== 'number' || !Number.isFinite(taille) || taille < 0) {
      trop = true
      return
    }
    total += taille
    if (taille > PLAFONDS_ZIP.fichierOctets || total > PLAFONDS_ZIP.totalOctets) trop = true
  })
  if (trop) throw new ExtractionError('fichierTropVolumineuxDecompresse')
}
