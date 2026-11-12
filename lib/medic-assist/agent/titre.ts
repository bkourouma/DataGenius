/**
 * Titre d'une conversation.
 *
 * Les fonctions pures (`titreDeRepli`, `nettoyerTitre`) ne dépendent pas du SDK ; seule
 * `genererTitre` appelle `generateText` de `ai` (les tests le simulent avec `vi.mock`).
 */

import { generateText, type LanguageModel } from 'ai'
import type { Locale } from '@/i18n/config'
import { LIMITES } from '@/lib/medic-assist/contrats'

const LONGUEUR_REPLI = 60
const LONGUEUR_MAX_ENTREE_MODELE = 1_500
const MAX_JETONS_TITRE = 40
const REPLI_PAR_DEFAUT = 'Data Genius'

const NOMS_LANGUES: Record<string, string> = {
  fr: 'français',
  en: 'English',
  es: 'español',
  zh: '中文',
  ar: 'العربية',
  hi: 'हिन्दी',
}

function compacter(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim()
}

/** Retire le balisage markdown courant d'une ligne. */
function sansMarkdown(ligne: string): string {
  return compacter(
    ligne
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^\s{0,3}(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, '')
      .replace(/(\*\*|__|~~|`)/g, '')
      .replace(/(^|\s)[*_]+|[*_]+(?=\s|$)/g, '$1')
  )
}

/** Tronque sur une frontière de mot, « … » compris dans la longueur maximale. */
function tronquer(texte: string, max: number): string {
  const symboles = Array.from(texte)
  if (symboles.length <= max) return texte
  const coupe = symboles.slice(0, max - 1).join('')
  const dernierEspace = coupe.lastIndexOf(' ')
  const base = dernierEspace > max / 3 ? coupe.slice(0, dernierEspace) : coupe
  return `${base.replace(/[\s.,;:!?،。]+$/u, '')}…`
}

/**
 * Titre de repli tiré de la question : première ligne utile, sans markdown, tronquée à
 * 60 caractères. Jamais vide : `repli` (traduit par l'appelant) sert quand rien n'est exploitable.
 */
export function titreDeRepli(question: string, repli: string = REPLI_PAR_DEFAUT): string {
  const valeurRepli = compacter(repli) || REPLI_PAR_DEFAUT
  let enBlocDeCode = false
  for (const ligneBrute of String(question ?? '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(ligneBrute)) {
      enBlocDeCode = !enBlocDeCode
      continue
    }
    if (enBlocDeCode) continue
    const ligne = sansMarkdown(ligneBrute)
    // Une ligne sans lettre ni chiffre (séparateur, tableau) n'est pas un titre.
    if (ligne && /[\p{L}\p{N}]/u.test(ligne)) return tronquer(ligne, LONGUEUR_REPLI)
  }
  return valeurRepli
}

const GUILLEMETS = /^["'“”„‘’«»「」『』`]+|["'“”„‘’«»「」『』`]+$/gu
const PREFIXE_TITRE = /^\s*(titre|title|título|titulo|标题|題名|العنوان|शीर्षक)\s*[:：-]\s*/iu
const PONCTUATION_FINALE = /[\s.,;:!?…،؛؟。！？、]+$/u

/** Nettoie la sortie brute du modèle : guillemets, préfixe, ponctuation finale, ≤ 120 caractères. */
export function nettoyerTitre(brut: string): string {
  let titre = String(brut ?? '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l !== '')
  titre = sansMarkdown(titre ?? '')
  for (let i = 0; i < 3; i += 1) {
    titre = titre
      .replace(GUILLEMETS, '')
      .replace(PREFIXE_TITRE, '')
      .replace(PONCTUATION_FINALE, '')
      .trim()
  }
  titre = compacter(titre)
  const symboles = Array.from(titre)
  if (symboles.length > LIMITES.longueurMaxTitre) {
    titre = symboles.slice(0, LIMITES.longueurMaxTitre).join('').trim()
  }
  return titre
}

export interface ParametresGenererTitre {
  /** Modèle rapide (le plus économique du fournisseur). */
  modele: LanguageModel
  question: string
  reponse: string
  locale: Locale
  signal?: AbortSignal
  /** Titre traduit à utiliser si le modèle échoue et que la question est inexploitable. */
  repli?: string
}

function limiter(texte: string): string {
  return Array.from(String(texte ?? ''))
    .slice(0, LONGUEUR_MAX_ENTREE_MODELE)
    .join('')
}

/** Demande au modèle rapide un titre de 3 à 7 mots ; retombe sur le repli à la moindre erreur. */
export async function genererTitre(parametres: ParametresGenererTitre): Promise<string> {
  const repli = titreDeRepli(parametres.question, parametres.repli)
  try {
    const langue = NOMS_LANGUES[parametres.locale] ?? NOMS_LANGUES.fr!
    const resultat = await generateText({
      model: parametres.modele,
      maxOutputTokens: MAX_JETONS_TITRE,
      abortSignal: parametres.signal,
      prompt: [
        'Donne un titre de 3 à 7 mots à cette conversation.',
        `Écris-le dans la langue de la question (par défaut : ${langue}).`,
        'Réponds uniquement par le titre : sans guillemets, sans point final, sans préfixe.',
        '',
        `Question : ${limiter(parametres.question)}`,
        `Réponse : ${limiter(parametres.reponse)}`,
      ].join('\n'),
    })
    const titre = nettoyerTitre(resultat.text)
    return titre || repli
  } catch {
    return repli
  }
}
