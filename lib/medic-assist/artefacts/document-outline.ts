/**
 * Plan d'un document (table des matières) à partir des titres markdown de ses blocs.
 *
 * Module pur. Seuls les titres ATX (`#`, `##`, `###`…) hors blocs de code sont retenus.
 * Les niveaux sont ramenés à 2 (`#` et `##`) ou 3 (`###` et plus) : un document d'artefact
 * n'a pas de grand titre, c'est la fiche qui porte le titre.
 *
 * L'id d'ancre est un slug stable et unique dans tout le document ; il garde les lettres de
 * toutes les écritures (arabe, chinois, hindi…) et retire accents et ponctuation latins.
 */

import type { BlocDocument } from '@/lib/medic-assist/contrats'

export type NiveauTitre = 2 | 3

export interface TitreDocument {
  niveau: NiveauTitre
  texte: string
  id: string
  /** Index du bloc dans `ArtefactDocument.blocs`. */
  bloc: number
  /** Ligne (à partir de 1) du titre dans le markdown du bloc. */
  ligne: number
}

export interface PlanDocument {
  titres: TitreDocument[]
  /** Par index de bloc, puis par numéro de ligne : l'id d'ancre du titre qui s'y trouve. */
  idsParBloc: Record<number, Record<number, string>>
  /** Nombre de caractères de markdown du document. */
  caracteres: number
}

/** Seuils de la table des matières (§ spécification). */
export const SEUIL_SECTIONS_TABLE_DES_MATIERES = 3
export const SEUIL_CARACTERES_TABLE_DES_MATIERES = 4000

/** Retire la mise en forme markdown en ligne d'un texte de titre. */
export function texteDeTitre(brut: string): string {
  return brut
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Slug : lettres et chiffres de toutes les écritures, séparés par des tirets. */
export function slugifier(texte: string): string {
  const base = texte
    .normalize('NFKD')
    // Seuls les accents latins sont retirés : les voyelles indiennes ou les signes
    // arabes font partie du mot.
    .replace(/[̀-ͯ]+/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'section'
}

/** Id unique : « mon-titre », puis « mon-titre-2 », « mon-titre-3 »… */
function idUnique(slug: string, pris: Set<string>): string {
  let id = slug
  let n = 2
  while (pris.has(id)) {
    id = `${slug}-${n}`
    n += 1
  }
  pris.add(id)
  return id
}

const TITRE_ATX = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/
const CLOTURE_CODE = /^ {0,3}(`{3,}|~{3,})/

/** Titres d'un markdown, sans id (l'unicité se règle sur tout le document). */
function titresBruts(markdown: string): { niveau: NiveauTitre; texte: string; ligne: number }[] {
  const resultat: { niveau: NiveauTitre; texte: string; ligne: number }[] = []
  let cloture: string | null = null
  const lignes = markdown.split(/\r\n|\r|\n/)
  lignes.forEach((ligne, index) => {
    const c = CLOTURE_CODE.exec(ligne)
    if (c) {
      const marque = c[1][0]
      if (cloture === null) cloture = marque
      else if (cloture === marque) cloture = null
      return
    }
    if (cloture !== null) return
    const m = TITRE_ATX.exec(ligne)
    if (!m) return
    const texte = texteDeTitre(m[2])
    if (!texte) return
    resultat.push({ niveau: m[1].length <= 2 ? 2 : 3, texte, ligne: index + 1 })
  })
  return resultat
}

/** Plan d'un document : titres des blocs `texte`, dans l'ordre, avec des ids uniques. */
export function planDocument(blocs: BlocDocument[]): PlanDocument {
  const pris = new Set<string>()
  const titres: TitreDocument[] = []
  const idsParBloc: Record<number, Record<number, string>> = {}
  let caracteres = 0
  blocs.forEach((bloc, index) => {
    if (bloc.type !== 'texte') return
    caracteres += bloc.markdown.length
    for (const t of titresBruts(bloc.markdown)) {
      const id = idUnique(slugifier(t.texte), pris)
      titres.push({ niveau: t.niveau, texte: t.texte, id, bloc: index, ligne: t.ligne })
      ;(idsParBloc[index] ??= {})[t.ligne] = id
    }
  })
  return { titres, idsParBloc, caracteres }
}

/** Plan d'un seul markdown (blocs de texte isolés, tests). */
export function extraireTitres(markdown: string): TitreDocument[] {
  return planDocument([{ type: 'texte', markdown }]).titres
}

/** La table des matières se justifie : au moins 3 sections, ou un long texte avec des titres. */
export function tableDesMatieresUtile(plan: PlanDocument): boolean {
  if (plan.titres.length === 0) return false
  return (
    plan.titres.length >= SEUIL_SECTIONS_TABLE_DES_MATIERES ||
    plan.caracteres > SEUIL_CARACTERES_TABLE_DES_MATIERES
  )
}
