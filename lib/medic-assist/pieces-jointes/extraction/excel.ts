/**
 * Extraction d'un classeur .xlsx (exceljs) : toutes les feuilles (20 au plus), sans jamais
 * lire plus de 5 001 lignes de donnees par feuille, meme si la feuille en compte des millions.
 */

import ExcelJS from 'exceljs'

import { ExtractionError } from '../erreurs'
import { PLAFONDS, type ContenuTableau } from '../types'
import { verifierTailleDecompressee } from './garde-zip'
import { CELLULE_VIDE, construireFeuille, type CelluleBrute } from './tableau'

/** Lignes lues au plus : 20 pour chercher l'en-tete, puis 5 001 lignes de donnees. */
const LIGNES_LUES_MAX = PLAFONDS.lignesRechercheEntete + PLAFONDS.lignesDonneesMax + 1

function jourIso(date: Date): string | null {
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

/** Texte d'une valeur riche (hyperlien, texte enrichi, resultat de formule...). */
function texteRiche(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return ''
  if (typeof valeur === 'string') return valeur
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur)
  if (valeur instanceof Date) return jourIso(valeur) ?? ''
  const objet = valeur as Record<string, unknown>
  if (Array.isArray(objet.richText)) {
    return (objet.richText as { text?: string }[]).map(p => p.text ?? '').join('')
  }
  if (typeof objet.text === 'string') return objet.text
  if (typeof objet.hyperlink === 'string') return objet.hyperlink
  return ''
}

/** Valeur d'une cellule exceljs, normalisee : formule -> resultat, erreur -> vide. */
export function normaliserCellule(valeur: unknown, format?: string): CelluleBrute {
  if (valeur === null || valeur === undefined) return CELLULE_VIDE
  if (typeof valeur === 'number') {
    return Number.isFinite(valeur) ? { genre: 'nombre', nombre: valeur, format } : CELLULE_VIDE
  }
  if (typeof valeur === 'boolean') return { genre: 'booleen', valeur }
  if (typeof valeur === 'string')
    return valeur.trim() === '' ? CELLULE_VIDE : { genre: 'brut', texte: valeur }
  if (valeur instanceof Date) {
    const iso = jourIso(valeur)
    return iso ? { genre: 'date', iso } : CELLULE_VIDE
  }
  const objet = valeur as Record<string, unknown>
  if ('error' in objet) return CELLULE_VIDE
  if ('formula' in objet || 'sharedFormula' in objet) {
    return 'result' in objet ? normaliserCellule(objet.result, format) : CELLULE_VIDE
  }
  const texte = texteRiche(valeur)
  return texte.trim() === '' ? CELLULE_VIDE : { genre: 'brut', texte }
}

function erreurDeChargement(erreur: unknown): ExtractionError {
  const message = erreur instanceof Error ? erreur.message : ''
  if (/password|encrypt|protect/i.test(message)) return new ExtractionError('classeurProtege')
  return new ExtractionError('classeurIllisible')
}

export async function extraireExcel(octets: Uint8Array, options: { preserverTexte?: boolean } = {}): Promise<ContenuTableau> {
  // Avant exceljs : refuse une bombe ZIP sans rien decompresser.
  await verifierTailleDecompressee(octets, erreurDeChargement)

  const classeur = new ExcelJS.Workbook()
  try {
    await classeur.xlsx.load(Buffer.from(octets) as unknown as ExcelJS.Buffer)
  } catch (erreur) {
    throw erreurDeChargement(erreur)
  }

  const feuillesSource = classeur.worksheets
  const feuilles = feuillesSource.slice(0, PLAFONDS.feuillesMax).map(feuille => {
    const total = feuille.rowCount
    const aLire = Math.min(total, LIGNES_LUES_MAX)
    const largeur = Math.min(Math.max(feuille.columnCount, 0), PLAFONDS.colonnesMax)

    const lignes: CelluleBrute[][] = []
    const numeros: number[] = []
    for (let numero = 1; numero <= aLire; numero++) {
      const ligne = feuille.getRow(numero)
      const cellules: CelluleBrute[] = []
      for (let c = 1; c <= largeur; c++) {
        const cellule = ligne.getCell(c)
        cellules.push(normaliserCellule(cellule.value, cellule.numFmt))
      }
      lignes.push(cellules)
      numeros.push(numero)
    }

    return construireFeuille({
      nom: feuille.name,
      preserverTexte: options.preserverTexte,
      lignes,
      numeros,
      indexColonnes: Array.from({ length: largeur }, (_, c) => c + 1),
      nbLignesTotal: total,
      coupe: total > aLire,
    })
  })

  return { type: 'tableau', feuilles, nbFeuilles: feuillesSource.length }
}
