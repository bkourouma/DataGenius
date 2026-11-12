/**
 * Outil `lire_piece_jointe` (implementation du lot 6 ; signature figee par le lot 0).
 *
 * Relit la piece du PROPRIETAIRE (userId dans le meme `where` que l'id), re-extrait le fichier
 * stocke, puis :
 *  - tableau : range les lignes dans un jeu de donnees (source 'piece_jointe', via
 *    `enregistrerJeuDeDonnees` du lot 2) et rend son ResultatJeu ;
 *  - texte / PDF : rend le texte, plafonne a 30 000 caracteres.
 *
 * Erreurs : `lirePieceJointe` LEVE `ErreurPieceJointe` (champs `code`, `statut`, `message`, codes
 * de erreurs.ts). L'agent (lot 1) l'attrape et la convertit en resultat d'outil avec
 * `versErreurOutil(erreur)` (reexporte ici) : `introuvable` (piece, fichier, feuille),
 * `entree_invalide` (plage) ou `piece_jointe_illisible` (fichier abime, protege, scan).
 *
 * `plage` de l'outil = reference A1 (A1:H200, B:D, A5:C). Pour un PDF ou un texte, la selection
 * de pages ou de lignes n'est pas exposee au modele : parametre INTERNE `selection` de `deps`.
 */

import { enregistrerJeuDeDonnees as enregistrerJeuLot2 } from '@/lib/medic-assist/donnees/outils'

import { depotPrisma, type DepotPiecesJointes } from './depot-prisma'
import { ErreurPieceJointe, versErreurOutil as versErreurOutilBrut } from './erreurs'
import { extraireContenu } from './extraction'
import type {
  ColonneJeu,
  ContenuPieceJointe,
  ContexteExecution,
  EnregistrerJeuDeDonnees,
  EntreeLirePieceJointe,
  ErreurOutil,
  LigneJeu,
  Provenance,
} from './imports-lot0'
import { traducteurProvenance, type Traducteur } from './provenance'
import { extensionDe, lireFichierStocke } from './stockage'
import {
  PLAFONDS,
  type ContenuTexte,
  type DependancesExtraction,
  type FeuilleExtraite,
} from './types'

/** Convertit une erreur de piece jointe en resultat d'outil pour le modele (lot 1). */
export function versErreurOutil(erreur: ErreurPieceJointe): ErreurOutil {
  return versErreurOutilBrut(erreur)
}

export interface DependancesLecture extends DependancesExtraction {
  depot?: DepotPiecesJointes
  lireFichier?: (nomStocke: string) => Promise<Buffer | null>
  enregistrerJeu?: EnregistrerJeuDeDonnees
  traducteur?: Traducteur
  /** INTERNE, non expose a l'outil : pages d'un PDF (« 2-4 ») ou lignes d'un texte (« 10-40 »). */
  selection?: string
}

// ---------------------------------------------------------------------------
// Plages
// ---------------------------------------------------------------------------

export interface PlageTableau {
  colonneDebut: number
  colonneFin: number
  ligneDebut: number
  ligneFin: number
}

function indexColonne(lettres: string): number {
  let n = 0
  for (const c of lettres.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64)
  return n
}

/**
 * Reference A1 : « A1:H200 », « B:D », « A5:C » (colonnes obligatoires, lignes facultatives)
 * ou une cellule seule « C7 ».
 */
export function analyserPlageTableau(plage: string): PlageTableau | null {
  const m = /^\s*([A-Za-z]{1,3})(\d{1,7})?\s*(?::\s*([A-Za-z]{1,3})(\d{1,7})?)?\s*$/.exec(plage)
  if (!m) return null
  const seule = m[3] === undefined
  if (seule && m[2] === undefined) return null
  const [c1, c2] = [indexColonne(m[1]), indexColonne(seule ? m[1] : m[3])]
  const l1 = m[2] ? Number(m[2]) : 1
  const l2 = seule ? l1 : m[4] ? Number(m[4]) : Number.POSITIVE_INFINITY
  if (l1 < 1 || l2 < l1) return null
  return {
    colonneDebut: Math.min(c1, c2),
    colonneFin: Math.max(c1, c2),
    ligneDebut: l1,
    ligneFin: l2,
  }
}

/** « 2-4 » ou « 3 » : numeros 1-based, bornes comprises. */
export function analyserPlageTexte(plage: string): { debut: number; fin: number } | null {
  const m = /^\s*(\d{1,9})\s*(?:-\s*(\d{1,9}))?\s*$/.exec(plage)
  if (!m) return null
  const debut = Number(m[1])
  const fin = m[2] ? Number(m[2]) : debut
  if (debut < 1 || fin < debut) return null
  return { debut, fin }
}

// ---------------------------------------------------------------------------
// Tableau
// ---------------------------------------------------------------------------

function choisirFeuille(feuilles: FeuilleExtraite[], demandee?: string): FeuilleExtraite {
  if (feuilles.length === 0) {
    throw new ErreurPieceJointe('feuilleIntrouvable', 'The workbook has no sheet.')
  }
  if (!demandee || demandee.trim() === '') return feuilles[0]
  const voulu = demandee.trim().toLowerCase()
  const trouvee = feuilles.find(f => f.nom.trim().toLowerCase() === voulu)
  if (!trouvee) {
    throw new ErreurPieceJointe(
      'feuilleIntrouvable',
      `Sheet "${demandee}" not found. Available sheets: ${feuilles.map(f => `"${f.nom}"`).join(', ')}.`
    )
  }
  return trouvee
}

/** Applique la plage : colonnes dans la plage, en-tete conservee, lignes hors plage ignorees. */
function appliquerPlage(
  feuille: FeuilleExtraite,
  plage: PlageTableau | null
): { colonnes: ColonneJeu[]; lignes: LigneJeu[] } {
  if (!plage) return { colonnes: feuille.colonnes, lignes: feuille.lignes }
  const gardees = feuille.colonnes.filter((_, i) => {
    const index = feuille.indexColonnes[i]
    return index >= plage.colonneDebut && index <= plage.colonneFin
  })
  const lignes: LigneJeu[] = []
  feuille.lignes.forEach((ligne, i) => {
    const numero = feuille.numerosLignes[i]
    if (numero < plage.ligneDebut || numero > plage.ligneFin) return
    const copie: LigneJeu = {}
    for (const col of gardees) copie[col.cle] = ligne[col.cle]
    lignes.push(copie)
  })
  return { colonnes: gardees, lignes }
}

async function lireTableau(
  contexte: ContexteExecution,
  entree: EntreeLirePieceJointe,
  nom: string,
  feuilles: FeuilleExtraite[],
  enregistrerJeu: EnregistrerJeuDeDonnees,
  t: Traducteur
): Promise<ContenuPieceJointe> {
  const feuille = choisirFeuille(feuilles, entree.feuille)

  const plageDemandee = entree.plage?.trim() ?? ''
  let plage: PlageTableau | null = null
  if (plageDemandee !== '') {
    plage = analyserPlageTableau(plageDemandee)
    if (!plage) {
      throw new ErreurPieceJointe(
        'plageInvalide',
        `Invalid range "${plageDemandee}". Use an A1 reference such as A1:H200.`
      )
    }
  }
  const { colonnes, lignes } = appliquerPlage(feuille, plage)
  if (colonnes.length === 0) {
    throw new ErreurPieceJointe(
      'plageInvalide',
      `The range "${plageDemandee}" contains no column of the sheet.`
    )
  }

  const regles = [t('regleNonVerifie'), t('regleTypesInferes')]
  if (colonnes.some(c => c.type === 'pourcentage')) regles.push(t('reglePourcentage'))
  if (feuille.tronque) {
    regles.push(t('regleTronque', { max: PLAFONDS.lignesDonneesMax, total: feuille.nbLignesVues }))
  }
  const filtres = [{ libelle: t('filtreFeuille'), valeur: feuille.nom }]
  if (plageDemandee !== '') filtres.push({ libelle: t('filtrePlage'), valeur: plageDemandee })

  const provenance: Provenance = {
    source: 'piece_jointe',
    libelleSource: nom,
    perimetre: { pays: 'tous', libelle: t('perimetre') },
    filtres,
    regles,
    calculeA: contexte.maintenant.toISOString(),
  }

  const resultat = await enregistrerJeu(contexte, {
    source: 'piece_jointe',
    requete: {
      pieceJointeId: entree.pieceJointeId,
      feuille: feuille.nom,
      ...(plageDemandee !== '' ? { plage: plageDemandee } : {}),
    },
    colonnes,
    lignes,
    provenance,
  })

  return {
    pieceJointeId: entree.pieceJointeId,
    nom,
    nature: 'tableau',
    feuilles: feuilles.map(f => f.nom),
    resultat,
    tronque: feuille.tronque || resultat.tronque,
  }
}

// ---------------------------------------------------------------------------
// Texte et PDF
// ---------------------------------------------------------------------------

interface Rendu {
  texte: string
  tronque: boolean
}

function lireTextePdf(contenu: ContenuTexte, selection?: string): Rendu {
  let bornes = { debut: 1, fin: Number.POSITIVE_INFINITY }
  if (selection && selection.trim() !== '') {
    const analysee = analyserPlageTexte(selection)
    if (!analysee) {
      throw new ErreurPieceJointe('plageInvalide', `Invalid page range "${selection}".`)
    }
    bornes = analysee
  }
  const demandees = contenu.pages.filter(p => p.numero >= bornes.debut && p.numero <= bornes.fin)
  if (demandees.length === 0) {
    throw new ErreurPieceJointe('plageInvalide', 'The page range contains no page of the PDF.')
  }

  const blocs: string[] = []
  let budget: number = PLAFONDS.caracteresRenduMax
  let derniere = 0
  let coupee = false
  for (const page of demandees) {
    const entete = `--- Page ${page.numero} ---\n`
    if (entete.length + page.texte.length <= budget) {
      blocs.push(entete + page.texte)
      budget -= entete.length + page.texte.length
      derniere = page.numero
      continue
    }
    if (blocs.length === 0) {
      // Une seule page depasse le plafond : on la coupe.
      blocs.push(entete + page.texte.slice(0, Math.max(budget - entete.length, 0)))
      derniere = page.numero
      coupee = true
    }
    break
  }

  const finDemandee = demandees[demandees.length - 1].numero
  const notes: string[] = []
  if (coupee) {
    notes.push(`Page ${derniere} was cut at the ${PLAFONDS.caracteresRenduMax}-character limit.`)
  }
  if (derniere < finDemandee) {
    notes.push(`Pages ${derniere + 1}-${finDemandee} are not shown (output limit).`)
  }
  if (contenu.tronque) {
    notes.push(`Only the first ${PLAFONDS.pagesPdfMax} of ${contenu.nbPages} pages were read.`)
  }
  const corps = blocs.join('\n\n')
  return {
    texte: notes.length > 0 ? `${corps}\n\n[${notes.join(' ')}]` : corps,
    tronque: coupee || derniere < finDemandee || contenu.tronque,
  }
}

function lireTexteBrut(contenu: ContenuTexte, selection?: string): Rendu {
  const lignes = (contenu.pages[0]?.texte ?? '').split('\n')
  let bornes = { debut: 1, fin: lignes.length }
  if (selection && selection.trim() !== '') {
    const analysee = analyserPlageTexte(selection)
    if (!analysee) {
      throw new ErreurPieceJointe('plageInvalide', `Invalid line range "${selection}".`)
    }
    bornes = { debut: analysee.debut, fin: Math.min(analysee.fin, lignes.length) }
  }
  if (bornes.debut > lignes.length) {
    throw new ErreurPieceJointe('plageInvalide', 'The line range is beyond the end of the file.')
  }

  const retenues: string[] = []
  let taille = 0
  let derniere = bornes.debut - 1
  for (let n = bornes.debut; n <= bornes.fin; n++) {
    const ligne = lignes[n - 1]
    const cout = ligne.length + 1
    if (taille + cout > PLAFONDS.caracteresRenduMax) {
      if (retenues.length === 0) {
        retenues.push(ligne.slice(0, PLAFONDS.caracteresRenduMax))
        derniere = n
      }
      break
    }
    retenues.push(ligne)
    taille += cout
    derniere = n
  }

  const notes: string[] = []
  if (derniere < bornes.fin) {
    notes.push(`Lines ${derniere + 1}-${bornes.fin} are not shown (output limit).`)
  }
  if (contenu.tronque) notes.push(`The file was cut at ${PLAFONDS.caracteresTexteMax} characters.`)
  const corps = retenues.join('\n')
  return {
    texte: notes.length > 0 ? `${corps}\n\n[${notes.join(' ')}]` : corps,
    tronque: derniere < bornes.fin || contenu.tronque,
  }
}

// ---------------------------------------------------------------------------
// Point d'entree
// ---------------------------------------------------------------------------

export async function lirePieceJointe(
  contexte: ContexteExecution,
  entree: EntreeLirePieceJointe,
  deps: DependancesLecture = {}
): Promise<ContenuPieceJointe> {
  const depot = deps.depot ?? depotPrisma

  // Proprietaire dans le MEME where que l'id : la piece d'un autre est « introuvable ».
  const ligne = await depot.lireDuProprietaire(entree.pieceJointeId, contexte.userId)
  if (!ligne) throw new ErreurPieceJointe('pieceJointeIntrouvable')

  const octets = await (deps.lireFichier ?? lireFichierStocke)(ligne.chemin)
  if (!octets) throw new ErreurPieceJointe('fichierStockeIntrouvable')

  const contenu = await extraireContenu(extensionDe(ligne.nomFichier), octets, {
    extrairePdf: deps.extrairePdf,
    nomFichier: ligne.nomFichier,
  })

  if (contenu.type === 'tableau') {
    return lireTableau(
      contexte,
      entree,
      ligne.nomFichier,
      contenu.feuilles,
      deps.enregistrerJeu ?? enregistrerJeuLot2,
      deps.traducteur ?? (await traducteurProvenance(contexte.locale))
    )
  }
  const rendu =
    contenu.format === 'pdf'
      ? lireTextePdf(contenu, deps.selection)
      : lireTexteBrut(contenu, deps.selection)
  return {
    pieceJointeId: entree.pieceJointeId,
    nom: ligne.nomFichier,
    nature: 'texte',
    texte: rendu.texte,
    tronque: rendu.tronque,
  }
}
