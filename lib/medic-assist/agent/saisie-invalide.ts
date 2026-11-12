/**
 * Saisie d'outil invalide : renvoyée au modèle comme résultat d'outil, pour qu'il se corrige.
 *
 * Mécanisme (SDK `ai` 7.0.159, node_modules/ai/dist/index.js, `parseToolCall`) : un appel dont
 * la saisie ne passe pas le schéma devient un `tool-call` `invalid`, suivi d'un `tool-error`
 * dont le texte est le message BRUT de zod (valeur reçue comprise, parfois plusieurs ko). Ce
 * texte part au modèle, et les parties `tool-input-error` / `tool-output-error` du flux passent
 * par `onError` (journal « erreur du flux » trompeur, carte d'outil en erreur côté client).
 * `repairToolCall` ne sait que réécrire un appel, pas renvoyer une erreur : il ne convient pas.
 *
 * Choix : le SDK ne valide plus (schéma tolérant, `schemaEntreeOutilTolerant`) ; `execute`
 * valide avec le schéma complet du contrat, et une saisie refusée devient une `ErreurOutil`
 * `entree_invalide` courte, en français, qui liste les valeurs admises. Le modèle voit toujours
 * le schéma compact. Les saisies refusées sont comptées par tour : au-delà de la borne, le tour
 * s'arrête et échoue avec une erreur classée (message masqué côté client).
 */

import type { z } from 'zod'

/**
 * Saisies invalides tolérées PAR TOUR, tous outils confondus (la troisième arrête le tour).
 * Justification : un modèle qui lit « valeurs admises : … » se corrige dès l'essai suivant ;
 * deux échecs laissent encore une chance après une confusion sur un autre outil, trois
 * montrent une boucle qui coûte des étapes (12 en standard, 25 en approfondi) et du délai sans
 * rien apporter. Un compteur par tour (et non consécutif) borne aussi l'alternance d'outils.
 */
export const BORNE_SAISIES_INVALIDES = 3

/** Message d'erreur du tour quand la borne est atteinte (journal serveur seulement). */
export class ErreurSaisieOutilRepetee extends Error {
  constructor(nbSaisies: number) {
    super(`${nbSaisies} saisies d'outil invalides dans le même tour`)
    this.name = 'ErreurSaisieOutilRepetee'
    Object.setPrototypeOf(this, ErreurSaisieOutilRepetee.prototype)
  }
}

/** Compteur partagé entre les outils d'un tour et le moteur (arrêt du tour). */
export interface SuiviSaisiesInvalides {
  nombre: number
  /** Vrai quand la borne est atteinte : le moteur arrête le tour après l'étape en cours. */
  readonly atteinte: () => boolean
}

export function creerSuiviSaisiesInvalides(borne = BORNE_SAISIES_INVALIDES): SuiviSaisiesInvalides {
  const suivi: SuiviSaisiesInvalides = { nombre: 0, atteinte: () => suivi.nombre >= borne }
  return suivi
}

const VALEURS_LISTEES_MAX = 15
const PROBLEMES_MAX = 3
const LONGUEUR_VALEUR_MAX = 40
const LONGUEUR_SEGMENT_MAX = 40

/** Segment de chemin tronqué comme une valeur courte (cf. `valeurCourte`). */
function segmentCourt(segment: PropertyKey): string {
  const texte = String(segment)
  return texte.length > LONGUEUR_SEGMENT_MAX ? `${texte.slice(0, LONGUEUR_SEGMENT_MAX - 1)}…` : texte
}

function formaterChemin(chemin: ReadonlyArray<PropertyKey>): string {
  let texte = ''
  for (const segment of chemin) {
    if (typeof segment === 'number') texte += `[${segment}]`
    else texte += texte ? `.${segmentCourt(segment)}` : segmentCourt(segment)
  }
  return texte
}

function valeurCourte(v: unknown): string {
  const texte = typeof v === 'string' ? `« ${v} »` : String(v)
  return texte.length > LONGUEUR_VALEUR_MAX ? `${texte.slice(0, LONGUEUR_VALEUR_MAX - 1)}…` : texte
}

function pluriel(n: number, mot: string): string {
  return `${n} ${mot}${n > 1 ? 's' : ''}`
}

/** Problème décrit pour une borne (taille d'un tableau, d'un texte ou d'un nombre). */
function decrireBorne(issue: z.core.$ZodIssue, minimum: boolean): string {
  const i = issue as unknown as { origin?: string; minimum?: unknown; maximum?: unknown }
  const n = Number(minimum ? i.minimum : i.maximum)
  const nombre = Number.isFinite(n) ? n : null
  if (i.origin === 'array' || i.origin === 'set') {
    if (nombre === null) return 'nombre d’éléments invalide'
    return `${minimum ? 'au moins' : 'au plus'} ${pluriel(nombre, 'élément')}`
  }
  if (i.origin === 'string') {
    if (nombre === null) return 'longueur invalide'
    return `${minimum ? 'au moins' : 'au plus'} ${pluriel(nombre, 'caractère')}`
  }
  return nombre === null ? 'valeur hors bornes' : `valeur ${minimum ? '≥' : '≤'} ${nombre}`
}

interface Probleme {
  chemin: string
  texte: string
}

/** Une branche d'union est jugée « la plus proche » quand elle a le moins de problèmes. */
function brancheLaPlusProche(branches: unknown): z.core.$ZodIssue[] | null {
  if (!Array.isArray(branches)) return null
  let meilleure: z.core.$ZodIssue[] | null = null
  for (const b of branches) {
    if (!Array.isArray(b) || b.length === 0) continue
    if (meilleure === null || b.length < meilleure.length) meilleure = b as z.core.$ZodIssue[]
  }
  return meilleure
}

function problemesDe(issues: readonly z.core.$ZodIssue[], prefixe: PropertyKey[]): Probleme[] {
  const sortie: Probleme[] = []
  for (const issue of issues) {
    const chemin = [...prefixe, ...issue.path]
    const cheminTexte = formaterChemin(chemin)
    switch (issue.code) {
      case 'invalid_union': {
        const proche = brancheLaPlusProche((issue as unknown as { errors?: unknown }).errors)
        if (proche) sortie.push(...problemesDe(proche, chemin))
        else sortie.push({ chemin: cheminTexte, texte: 'forme non reconnue' })
        break
      }
      case 'invalid_value': {
        const valeurs = issue.values as readonly unknown[]
        const listees = valeurs.slice(0, VALEURS_LISTEES_MAX).map(v => String(v))
        const suite = valeurs.length > VALEURS_LISTEES_MAX ? ', …' : ''
        sortie.push({
          chemin: cheminTexte,
          texte: `valeur non admise ; valeurs admises : ${listees.join(', ')}${suite}`,
        })
        break
      }
      case 'invalid_type':
        // zod ne rapporte pas la valeur reçue : absent ou de mauvais type, le correctif est le même.
        sortie.push({ chemin: cheminTexte, texte: `type attendu : ${String(issue.expected)}` })
        break
      case 'unrecognized_keys': {
        const cles = issue.keys.slice(0, 5).map(valeurCourte).join(', ')
        sortie.push({ chemin: cheminTexte, texte: `champ(s) inconnu(s) : ${cles}` })
        break
      }
      case 'too_small':
        sortie.push({ chemin: cheminTexte, texte: decrireBorne(issue, true) })
        break
      case 'too_big':
        sortie.push({ chemin: cheminTexte, texte: decrireBorne(issue, false) })
        break
      case 'invalid_format':
        sortie.push({ chemin: cheminTexte, texte: 'format invalide (voir le schéma)' })
        break
      case 'custom':
        // Règles du contrat (refine) : messages écrits en français pour le modèle.
        sortie.push({ chemin: cheminTexte, texte: issue.message })
        break
      default:
        sortie.push({ chemin: cheminTexte, texte: 'valeur invalide' })
    }
  }
  return sortie
}

/**
 * Message court (en français, sans valeur reçue, sans pile ni JSON) qui dit au modèle quoi
 * corriger : chemin du champ fautif, nature du problème, valeurs admises pour une énumération.
 */
export function decrireSaisieInvalide(nomOutil: string, erreur: z.ZodError): string {
  const problemes = problemesDe(erreur.issues, [])
  const vus = new Set<string>()
  const retenus: string[] = []
  for (const p of problemes) {
    const ligne = p.chemin ? `${p.chemin} : ${p.texte}` : p.texte
    if (vus.has(ligne)) continue
    vus.add(ligne)
    retenus.push(ligne)
    if (retenus.length >= PROBLEMES_MAX) break
  }
  const detail = retenus.length > 0 ? retenus.join(' ; ') : 'saisie non conforme au schéma'
  const reste = vus.size < problemes.length ? ' (autres problèmes ensuite)' : ''
  return `Saisie invalide pour ${nomOutil} : ${detail}${reste}. Corrige et réessaie.`
}
