/**
 * Extraction PDF par `unpdf` (2.1.0), charge par import dynamique ICI SEULEMENT. Ce module est
 * lui-meme charge a la demande par index.ts : un souci de chargement de `unpdf` reste limite aux PDF
 * (erreur `pdfNonDisponible`).
 */

import type { ContenuTexte } from '../types'
import { extrairePdfAvec } from './pdf-logique'

export function extrairePdf(octets: Uint8Array): Promise<ContenuTexte> {
  return extrairePdfAvec(() => import('unpdf'), octets)
}
