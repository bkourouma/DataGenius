/** Dispatcher d'extraction : fonction pure sur les octets, sans acces base. */

import { ErreurPieceJointe } from '../erreurs'
import type { ContenuExtrait, DependancesExtraction, ExtracteurPdf } from '../types'
import { extraireCsv } from './csv'
import { extraireExcel } from './excel'
import { extraireTexte } from './texte'

/** Charge pdf.ts (et donc `unpdf`) seulement quand un PDF est lu. */
const extrairePdfParDefaut: ExtracteurPdf = async octets =>
  (await import('./pdf')).extrairePdf(octets)

export async function extraireContenu(
  extension: string,
  octets: Uint8Array,
  deps: DependancesExtraction & { nomFichier?: string } = {}
): Promise<ContenuExtrait> {
  switch (extension.toLowerCase()) {
    case 'xlsx':
      return extraireExcel(octets)
    case 'csv':
      return extraireCsv(octets, deps.nomFichier)
    case 'txt':
      return extraireTexte(octets)
    case 'pdf':
      return (deps.extrairePdf ?? extrairePdfParDefaut)(octets)
    case 'xls':
      throw new ErreurPieceJointe('formatXlsNonPrisEnCharge')
    default:
      throw new ErreurPieceJointe('extensionRefusee')
  }
}

export { extraireCsv, extraireExcel, extraireTexte }
