/**
 * Erreurs typees du flux de chat. Le serveur emet une erreur dont le texte vaut
 * `medic_assist_erreur:<code>` ; on en tire un code, jamais de detail technique
 * a l'ecran (les messages viennent de `medicAssist.erreurs.<code>`).
 */

export const CODES_ERREUR_CHAT = [
  'fournisseur_indisponible',
  'fournisseur_non_configure',
  'limite_debit',
  'quota_epuise',
  'authentification_fournisseur',
  'requete_trop_longue',
  'delai_depasse',
  'annule',
  'contenu_refuse',
  'interne',
] as const

export type CodeErreurChat = (typeof CODES_ERREUR_CHAT)[number] | 'inconnue'

const MOTIF = /medic_assist_erreur:([a-z_]+)/

function texteDe(erreur: unknown): string {
  if (typeof erreur === 'string') return erreur
  if (erreur instanceof Error) return erreur.message
  if (erreur && typeof erreur === 'object' && 'message' in erreur) {
    const message = (erreur as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

/** Codes JSON d'avant le flux (corps `{ error }` d'une reponse non-OK) qui ont deja un message. */
const CODES_JSON_AVANT_FLUX: Readonly<Record<string, CodeErreurChat>> = {
  internal: 'interne',
  payload_too_large: 'requete_trop_longue',
}

function estCodeChat(code: string): code is Exclude<CodeErreurChat, 'inconnue'> {
  return (CODES_ERREUR_CHAT as readonly string[]).includes(code)
}

/**
 * Le transport du SDK leve une erreur dont le message est le corps brut d'une reponse
 * non-OK : ici `{"error":"<code>","message":"..."}`. Lecture prudente, jamais d'exception.
 */
function codeDuCorpsJson(texte: string): CodeErreurChat | null {
  const debut = texte.indexOf('{')
  if (debut === -1) return null
  try {
    const corps: unknown = JSON.parse(texte.slice(debut))
    const code = corps && typeof corps === 'object' ? (corps as { error?: unknown }).error : null
    if (typeof code !== 'string') return null
    if (estCodeChat(code)) return code
    if (!Object.hasOwn(CODES_JSON_AVANT_FLUX, code)) return null
    const equivalent = CODES_JSON_AVANT_FLUX[code]
    return estCodeChat(equivalent) ? equivalent : null
  } catch {
    return null
  }
}

/** Code de l'erreur ; 'inconnue' si le texte est absent ou le code non reconnu. */
export function extraireCodeErreur(erreur: unknown): CodeErreurChat {
  const texte = texteDe(erreur)
  const code = MOTIF.exec(texte)?.[1]
  if (code && estCodeChat(code)) return code
  return codeDuCorpsJson(texte) ?? 'inconnue'
}

const REESSAYABLES: ReadonlySet<CodeErreurChat> = new Set([
  'fournisseur_indisponible',
  'limite_debit',
  'delai_depasse',
  'interne',
  'inconnue',
])

/** Reessayer a un sens pour les pannes passageres, pas pour un refus durable. */
export function erreurReessayable(code: CodeErreurChat): boolean {
  return REESSAYABLES.has(code)
}

/** Cle i18n (espace `medicAssist`) du message du code. */
export function cleMessageErreur(code: CodeErreurChat): `erreurs.${CodeErreurChat}` {
  return `erreurs.${code}`
}
