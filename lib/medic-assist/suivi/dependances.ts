/**
 * SEUL point de couture du suivi avec le lot 4 (export des artefacts).
 *
 * Les services du suivi importent ce module (jamais le lot 4 directement) ; les
 * tests le mockent avec vi.mock('@/lib/medic-assist/suivi/dependances').
 *
 * Le lot 4 expose `construireExport(contexte, artefactId, format, options?)` ; le suivi garde
 * l'ordre historique `(artefactId, format, contexte)` de ses appelants et ajoute `options`.
 */

import { construireExport as construireExportLot4 } from '@/lib/medic-assist/artefacts/exports'
import type { ResultatExport } from '@/lib/medic-assist/artefacts/exports/types'
import type { ContexteExecution, FormatEnvoi } from '@/lib/medic-assist/contrats'

/** Pièce jointe produite par le lot 4 (buffer, nomFichier, typeMime), telle quelle. */
export type ResultatExportArtefact = ResultatExport

export interface OptionsExportSuivi {
  /** Nom affiché de la personne qui exporte (jamais son id) ; absent : non mentionné. */
  exportePar?: string
}

/**
 * Exporte un artefact recalcule dans le perimetre du `contexte` (le proprietaire
 * pour un rapport programme, l'expediteur pour un e-mail).
 * FormatEnvoi (xlsx, pdf, csv) est un sous-ensemble de FormatExport du lot 4.
 */
export type ConstruireExport = (
  artefactId: string,
  format: FormatEnvoi,
  contexte: ContexteExecution,
  options?: OptionsExportSuivi
) => Promise<ResultatExportArtefact>

export const construireExport: ConstruireExport = (artefactId, format, contexte, options) =>
  construireExportLot4(contexte, artefactId, format, {
    ...(options?.exportePar ? { exportePar: options.exportePar } : {}),
  })
