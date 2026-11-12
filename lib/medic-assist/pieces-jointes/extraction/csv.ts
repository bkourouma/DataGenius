/**
 * Extraction d'un fichier CSV : separateur detecte, encodage UTF-8 ou Windows-1252,
 * analyseur RFC 4180 ecrit a la main (guillemets doubles, retours a la ligne dans un champ).
 */

import { PLAFONDS, type ContenuTableau } from '../types'
import { decoderTexte } from './decodage'
import { construireFeuille, type CelluleBrute } from './tableau'

const SEPARATEURS = [';', ',', '\t', '|'] as const

/** Lignes gardees en memoire : 20 pour l'en-tete, 5 001 de donnees. */
const ENREGISTREMENTS_GARDES = PLAFONDS.lignesRechercheEntete + PLAFONDS.lignesDonneesMax + 1

/** Separateur le plus regulier sur les premieres lignes, guillemets ignores. */
export function detecterSeparateur(texte: string): string {
  const lignes: string[] = []
  let courante = ''
  let entreGuillemets = false
  for (let i = 0; i < texte.length && lignes.length < 10; i++) {
    const c = texte[i]
    if (c === '"') entreGuillemets = !entreGuillemets
    if (!entreGuillemets && (c === '\n' || c === '\r')) {
      if (courante.trim() !== '') lignes.push(courante)
      courante = ''
      continue
    }
    courante += c
  }
  if (courante.trim() !== '' && lignes.length < 10) lignes.push(courante)

  const compter = (ligne: string, sep: string) => {
    let n = 0
    let dedans = false
    for (const c of ligne) {
      if (c === '"') dedans = !dedans
      else if (!dedans && c === sep) n++
    }
    return n
  }

  let meilleur = ';'
  let meilleurScore = 0
  for (const sep of SEPARATEURS) {
    const comptes = lignes.map(l => compter(l, sep))
    const frequences = new Map<number, number>()
    for (const n of comptes) if (n > 0) frequences.set(n, (frequences.get(n) ?? 0) + 1)
    let modal = 0
    let effectif = 0
    for (const [n, f] of frequences) {
      if (f > effectif || (f === effectif && n > modal)) {
        modal = n
        effectif = f
      }
    }
    const score = effectif * 1000 + modal
    if (score > meilleurScore) {
      meilleurScore = score
      meilleur = sep
    }
  }
  return meilleur
}

export interface EnregistrementsCsv {
  /** Les premiers enregistrements (au plus `gardes`). */
  enregistrements: string[][]
  /** Nombre total d'enregistrements non vides. */
  total: number
}

/**
 * Analyse RFC 4180. Les enregistrements vides (ligne sans caractere) sont ignores ; au plus
 * `gardes` enregistrements sont conserves, les suivants sont seulement comptes.
 */
export function analyserCsv(texte: string, separateur: string, gardes: number): EnregistrementsCsv {
  const enregistrements: string[][] = []
  let total = 0
  let champs: string[] = []
  let champ = ''
  let entreGuillemets = false
  let champGuillemete = false
  let enCours = false // l'enregistrement a deja un caractere

  const finChamp = () => {
    champs.push(champ)
    champ = ''
    champGuillemete = false
  }
  const finEnregistrement = () => {
    if (enCours) {
      finChamp()
      total++
      if (enregistrements.length < gardes) enregistrements.push(champs)
    }
    champs = []
    champ = ''
    champGuillemete = false
    enCours = false
  }

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]
    if (entreGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') {
          champ += '"'
          i++
        } else {
          entreGuillemets = false
        }
      } else {
        champ += c
      }
      continue
    }
    if (c === '"' && champ === '' && !champGuillemete) {
      entreGuillemets = true
      champGuillemete = true
      enCours = true
    } else if (c === separateur) {
      enCours = true
      finChamp()
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++
      finEnregistrement()
    } else {
      champ += c
      enCours = true
    }
  }
  finEnregistrement()
  return { enregistrements, total }
}

/** Nom de feuille d'apres le nom du fichier, sans extension. */
function nomDeFeuille(nomFichier?: string): string {
  const sansExtension = (nomFichier ?? '').replace(/\.[^.]*$/, '').trim()
  return sansExtension.slice(0, 31) || 'Feuille1'
}

export function extraireCsv(octets: Uint8Array, nomFichier?: string): ContenuTableau {
  const texte = decoderTexte(octets)
  const separateur = detecterSeparateur(texte)
  const { enregistrements, total } = analyserCsv(texte, separateur, ENREGISTREMENTS_GARDES)

  const largeur = Math.min(
    PLAFONDS.colonnesMax,
    enregistrements.reduce((max, r) => Math.max(max, r.length), 0)
  )
  const lignes: CelluleBrute[][] = enregistrements.map(r =>
    Array.from({ length: largeur }, (_, c) => {
      const valeur = r[c]
      return valeur === undefined || valeur.trim() === ''
        ? ({ genre: 'vide' } as const)
        : ({ genre: 'brut', texte: valeur } as const)
    })
  )

  const feuille = construireFeuille({
    nom: nomDeFeuille(nomFichier),
    lignes,
    numeros: lignes.map((_, i) => i + 1),
    indexColonnes: Array.from({ length: largeur }, (_, c) => c + 1),
    nbLignesTotal: total,
    coupe: total > enregistrements.length,
  })
  return { type: 'tableau', feuilles: [feuille], nbFeuilles: 1 }
}
