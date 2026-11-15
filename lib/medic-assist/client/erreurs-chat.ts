/**
 * Erreurs typees du flux de chat. Le serveur emet une erreur dont le texte vaut
 * `medic_assist_erreur:<code>` ; on en tire un code, jamais de detail technique
 * a l'ecran (les messages viennent de `medicAssist.erreurs.<code>`, ou de
 * `medicAssist.gardeFous.erreurs.<code>` pour les codes des garde-fous).
 *
 * Les reponses JSON d'avant le flux ont la forme `{ error, message, details }` ; `details` peut
 * porter `reference` (reference courte `DG-XXXXXX` a citer au support) et `reinitialisationA`
 * (ISO, fin du plafond journalier). Pour une erreur emise dans le flux, le serveur peut ajouter
 * la reference apres le code (`medic_assist_erreur:interne DG-7K3F9Q`).
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
  // Garde-fous (409) : un tour est deja en cours / ce message a deja ete recu.
  'tour_en_cours',
  'message_deja_recu',
] as const

export type CodeErreurChat = (typeof CODES_ERREUR_CHAT)[number] | 'inconnue'

/** Codes dont le message est sous `gardeFous.erreurs` (aucune valeur existante modifiee). */
const CODES_GARDE_FOUS: ReadonlySet<CodeErreurChat> = new Set(['tour_en_cours', 'message_deja_recu'])

const MOTIF = /medic_assist_erreur:([a-z_]+)/
const MOTIF_REFERENCE = /\bDG-[A-HJ-NP-Z2-9]{6}\b/
const MOTIF_ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/

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

/** Corps JSON `{ error, message, details }` porte par le message de l'erreur du transport. */
function corpsJson(texte: string): { error?: unknown; details?: unknown } | null {
  const debut = texte.indexOf('{')
  if (debut === -1) return null
  try {
    const corps: unknown = JSON.parse(texte.slice(debut))
    return corps && typeof corps === 'object'
      ? (corps as { error?: unknown; details?: unknown })
      : null
  } catch {
    return null
  }
}

/**
 * Le transport du SDK leve une erreur dont le message est le corps brut d'une reponse
 * non-OK : ici `{"error":"<code>","message":"..."}`. Lecture prudente, jamais d'exception.
 */
function codeDuCorpsJson(texte: string): CodeErreurChat | null {
  const code = corpsJson(texte)?.error
  if (typeof code !== 'string') return null
  if (estCodeChat(code)) return code
  if (!Object.hasOwn(CODES_JSON_AVANT_FLUX, code)) return null
  const equivalent = CODES_JSON_AVANT_FLUX[code]
  return estCodeChat(equivalent) ? equivalent : null
}

/** Code de l'erreur ; 'inconnue' si le texte est absent ou le code non reconnu. */
export function extraireCodeErreur(erreur: unknown): CodeErreurChat {
  const texte = texteDe(erreur)
  const code = MOTIF.exec(texte)?.[1]
  if (code && estCodeChat(code)) return code
  return codeDuCorpsJson(texte) ?? 'inconnue'
}

export interface DetailsErreurChat {
  /** Reference courte a citer au support (ex. DG-7K3F9Q). */
  reference?: string
  /** Instant ISO de la fin du plafond journalier. */
  reinitialisationA?: string
}

function isoValide(valeur: unknown): string | undefined {
  if (typeof valeur !== 'string') return undefined
  const iso = MOTIF_ISO.exec(valeur)?.[0]
  return iso && !Number.isNaN(Date.parse(iso)) ? iso : undefined
}

/**
 * Details portes par l'erreur : `details` du corps JSON, ou suffixe de reference / date ISO apres
 * le code d'une erreur du flux. Lecture prudente : jamais d'exception, champs absents omis.
 */
export function extraireDetailsErreur(erreur: unknown): DetailsErreurChat {
  const resultat: DetailsErreurChat = {}
  try {
    const texte = texteDe(erreur)
    const details = corpsJson(texte)?.details
    if (details && typeof details === 'object') {
      const { reference, reinitialisationA } = details as Record<string, unknown>
      const ref = typeof reference === 'string' ? MOTIF_REFERENCE.exec(reference)?.[0] : undefined
      if (ref) resultat.reference = ref
      const iso = isoValide(reinitialisationA)
      if (iso) resultat.reinitialisationA = iso
    }
    const flux = MOTIF.exec(texte)
    if (flux) {
      const suite = texte.slice(flux.index + flux[0].length)
      if (!resultat.reference) {
        const ref = MOTIF_REFERENCE.exec(suite)?.[0]
        if (ref) resultat.reference = ref
      }
      if (!resultat.reinitialisationA) {
        const iso = isoValide(suite)
        if (iso) resultat.reinitialisationA = iso
      }
    }
  } catch {
    // lecture prudente : on rend ce qui a ete lu
  }
  return resultat
}

const REESSAYABLES: ReadonlySet<CodeErreurChat> = new Set([
  'fournisseur_indisponible',
  'limite_debit',
  'delai_depasse',
  'interne',
  'tour_en_cours',
  'inconnue',
])

/** Reessayer a un sens pour les pannes passageres, pas pour un refus durable. */
export function erreurReessayable(code: CodeErreurChat): boolean {
  return REESSAYABLES.has(code)
}

/** Cle i18n (espace `medicAssist`) du message du code. */
export function cleMessageErreur(
  code: CodeErreurChat
): `erreurs.${CodeErreurChat}` | `gardeFous.erreurs.${CodeErreurChat}` {
  return CODES_GARDE_FOUS.has(code) ? `gardeFous.erreurs.${code}` : `erreurs.${code}`
}

/**
 * Heure de reinitialisation formatee dans la langue de l'interface (heure locale du navigateur).
 * Le jour est ajoute quand ce n'est pas aujourd'hui. null si la date est invalide.
 */
export function formaterReinitialisation(
  iso: string,
  locale: string,
  maintenant: Date = new Date()
): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  try {
    const memeJour = date.toDateString() === maintenant.toDateString()
    return new Intl.DateTimeFormat(locale, {
      ...(memeJour ? {} : { weekday: 'short', day: 'numeric', month: 'short' }),
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  } catch {
    return null
  }
}

/** Cle et valeurs ICU du message a afficher (quota avec heure de reinitialisation si connue). */
export function descriptionMessageErreur(
  code: CodeErreurChat,
  details: DetailsErreurChat,
  locale: string,
  maintenant: Date = new Date()
): { cle: string; valeurs: Record<string, string> } {
  if (code === 'quota_epuise' && details.reinitialisationA) {
    const heure = formaterReinitialisation(details.reinitialisationA, locale, maintenant)
    if (heure) return { cle: 'gardeFous.quotaEpuiseHeure', valeurs: { heure } }
  }
  return { cle: cleMessageErreur(code), valeurs: {} }
}
