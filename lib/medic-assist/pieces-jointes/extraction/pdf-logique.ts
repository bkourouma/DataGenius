/**
 * Logique d'extraction PDF, independante de la bibliotheque : le chargeur de `unpdf` est
 * fourni par pdf.ts (seul fichier qui l'importe), ce qui permet de tester avec une doublure.
 *
 * API unpdf utilisee : `getDocumentProxy` (documentee), puis `getPage` / `getTextContent` de
 * pdf.js sur les 50 premieres pages. `extractText` n'est pas employe : il traite TOUTES les
 * pages en un appel (le README demande de borner le nombre de pages avant), alors qu'ici un PDF
 * de milliers de pages ne doit coûter que 50 pages de travail.
 *
 * Garde-fous : 50 pages, images decodees plafonnees a ~16 Mpixels (`maxImageSize`), delai total
 * borne. Un PDF sans texte (scan) est refuse : pas d'OCR.
 */

import { ExtractionError } from '../erreurs'
import { PLAFONDS, type ContenuTexte } from '../types'

/** Element de texte pdf.js ; les elements de contenu marque n'ont pas de `str`. */
interface ElementTexte {
  str?: string
  hasEOL?: boolean
}
interface PagePdf {
  getTextContent(): Promise<{ items: readonly unknown[] }>
}
interface DocumentPdf {
  numPages: number
  getPage(numero: number): Promise<PagePdf>
  destroy?: () => Promise<void>
}
export interface ModuleUnpdf {
  getDocumentProxy(donnees: Uint8Array, options?: { maxImageSize?: number }): Promise<DocumentPdf>
}

export type ChargeurUnpdf = () => Promise<ModuleUnpdf>

/** ~16 Mpixels : une image declaree enorme ne peut pas allouer des gigaoctets. */
const TAILLE_IMAGE_MAX = 16_777_216
/** Delai total de lecture d'un PDF (le build serverless tourne sur la boucle d'evenements). */
export const DELAI_PDF_MS = 30_000

async function charger(chargeur: ChargeurUnpdf): Promise<ModuleUnpdf> {
  try {
    return await chargeur()
  } catch {
    throw new ExtractionError('pdfNonDisponible')
  }
}

function texteDePage(items: readonly unknown[]): string {
  let texte = ''
  for (const element of items) {
    const item = element as ElementTexte
    texte += item.str ?? ''
    if (item.hasEOL) texte += '\n'
  }
  return texte.replace(/[ \t]+\n/g, '\n').trim()
}

function erreurPdf(erreur: unknown): ExtractionError {
  if (erreur instanceof ExtractionError) return erreur
  const nom = (erreur as { name?: string })?.name ?? ''
  return new ExtractionError(nom === 'PasswordException' ? 'pdfProtege' : 'pdfIllisible')
}

async function lire(
  unpdf: ModuleUnpdf,
  octets: Uint8Array,
  ouvert: { document?: DocumentPdf }
): Promise<ContenuTexte> {
  // pdf.js transfere le tampon : on lui donne une copie.
  const document = await unpdf.getDocumentProxy(new Uint8Array(octets), {
    maxImageSize: TAILLE_IMAGE_MAX,
  })
  ouvert.document = document

  const nbPages = document.numPages
  const aLire = Math.min(nbPages, PLAFONDS.pagesPdfMax)
  const pages: { numero: number; texte: string }[] = []
  for (let numero = 1; numero <= aLire; numero++) {
    const page = await document.getPage(numero)
    const contenu = await page.getTextContent()
    pages.push({ numero, texte: texteDePage(contenu.items) })
  }
  if (pages.every(p => p.texte === '')) throw new ExtractionError('pdfSansTexte')
  return { type: 'texte', format: 'pdf', pages, nbPages, tronque: nbPages > aLire }
}

export async function extrairePdfAvec(
  chargeur: ChargeurUnpdf,
  octets: Uint8Array,
  delaiMs: number = DELAI_PDF_MS
): Promise<ContenuTexte> {
  const unpdf = await charger(chargeur)

  let minuteur: ReturnType<typeof setTimeout> | undefined
  const delai = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new ExtractionError('pdfIllisible')), delaiMs)
  })

  const ouvert: { document?: DocumentPdf } = {}
  try {
    return await Promise.race([lire(unpdf, octets, ouvert), delai])
  } catch (erreur) {
    throw erreurPdf(erreur)
  } finally {
    clearTimeout(minuteur)
    await ouvert.document?.destroy?.().catch(() => undefined)
  }
}
