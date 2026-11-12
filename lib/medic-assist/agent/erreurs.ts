/**
 * Classement des erreurs du moteur de l'agent.
 *
 * Par duck-typing : aucun import du SDK. On lit `statusCode`, `status`, `name`, `message`,
 * `cause`, `lastError`/`errors` (RetryError) et `responseBody`.
 *
 * Règle de confidentialité : le client ne reçoit JAMAIS un message brut, une URL, une clé
 * ni un détail du fournisseur. `formaterErreurFlux` ne renvoie que `medic_assist_erreur:<code>`,
 * que le client traduit par la clé i18n `medicAssist.erreurs.<code>`.
 */
import { ErreurFournisseurAbsent } from '@/lib/medic-assist/config/types'

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
export type CodeErreurChat = (typeof CODES_ERREUR_CHAT)[number]

export const MESSAGE_ERREUR_FLUX_PREFIXE = 'medic_assist_erreur:'

export interface ClassementErreur {
  code: CodeErreurChat
  statutHttp: number
  retentable: boolean
}

/** Levée quand la clé du fournisseur choisi manque : classe définie dans la configuration. */
export { ErreurFournisseurAbsent }

const CLASSEMENTS: Record<CodeErreurChat, ClassementErreur> = {
  fournisseur_indisponible: { code: 'fournisseur_indisponible', statutHttp: 503, retentable: true },
  // Aucune clé installée : configuration serveur, un nouvel essai ne change rien.
  fournisseur_non_configure: {
    code: 'fournisseur_non_configure',
    statutHttp: 503,
    retentable: false,
  },
  limite_debit: { code: 'limite_debit', statutHttp: 429, retentable: true },
  quota_epuise: { code: 'quota_epuise', statutHttp: 402, retentable: false },
  // Problème de configuration côté serveur : 502, jamais le 401/403 du fournisseur.
  authentification_fournisseur: {
    code: 'authentification_fournisseur',
    statutHttp: 502,
    retentable: false,
  },
  requete_trop_longue: { code: 'requete_trop_longue', statutHttp: 413, retentable: false },
  delai_depasse: { code: 'delai_depasse', statutHttp: 504, retentable: true },
  annule: { code: 'annule', statutHttp: 499, retentable: false },
  contenu_refuse: { code: 'contenu_refuse', statutHttp: 422, retentable: false },
  interne: { code: 'interne', statutHttp: 500, retentable: false },
}

function classement(code: CodeErreurChat): ClassementErreur {
  return { ...CLASSEMENTS[code] }
}

interface Candidat {
  status?: number
  name: string
  texte: string
  code: string
  /** Type d'erreur du fournisseur (ex. `overloaded_error`), en minuscules ; vide si inconnu. */
  type: string
  /** Message brut de l'erreur (pour le journal uniquement). */
  message: string
}

function enNombre(valeur: unknown): number | undefined {
  if (typeof valeur === 'number' && Number.isFinite(valeur)) return valeur
  if (typeof valeur === 'string' && /^\d{3}$/.test(valeur.trim())) return Number(valeur)
  return undefined
}

function enTexte(valeur: unknown): string {
  if (typeof valeur === 'string') return valeur.slice(0, 4_000)
  if (valeur === undefined || valeur === null) return ''
  try {
    return (JSON.stringify(valeur) ?? '').slice(0, 4_000)
  } catch {
    return ''
  }
}

function enObjet(valeur: unknown): Record<string, unknown> | undefined {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
    ? (valeur as Record<string, unknown>)
    : undefined
}

/** Type d'erreur Anthropic d'un objet : `type` (hors enveloppe `error`) ou `error.type`. */
function lireTypeFournisseur(o: Record<string, unknown> | undefined): string {
  if (!o) return ''
  if (typeof o.type === 'string' && o.type !== 'error') return o.type.toLowerCase()
  const interne = enObjet(o.error)
  if (interne && typeof interne.type === 'string' && interne.type !== 'error') {
    return interne.type.toLowerCase()
  }
  return ''
}

/** Corps de réponse du fournisseur lu comme JSON (objet ou chaîne), `undefined` sinon. */
function lireCorps(valeur: unknown): Record<string, unknown> | undefined {
  if (typeof valeur === 'string') {
    try {
      return enObjet(JSON.parse(valeur))
    } catch {
      return undefined
    }
  }
  return enObjet(valeur)
}

/** L'erreur et ses causes (cause, lastError, errors, error), profondeur et nombre bornés. */
function collecterCandidats(error: unknown): Candidat[] {
  const candidats: Candidat[] = []
  const vus = new Set<unknown>()
  const file: Array<{ valeur: unknown; profondeur: number }> = [{ valeur: error, profondeur: 0 }]

  while (file.length > 0 && candidats.length < 12) {
    const { valeur, profondeur } = file.shift()!
    if (valeur === null || valeur === undefined || vus.has(valeur)) continue
    vus.add(valeur)

    if (typeof valeur === 'string') {
      candidats.push({
        name: '',
        texte: valeur.slice(0, 4_000).toLowerCase(),
        code: '',
        type: '',
        message: valeur.slice(0, 500),
      })
      continue
    }
    if (typeof valeur !== 'object') continue
    const o = valeur as Record<string, unknown>
    const reponse = (
      typeof o.response === 'object' && o.response !== null ? o.response : {}
    ) as Record<string, unknown>
    const donnees = (typeof o.data === 'object' && o.data !== null ? o.data : {}) as Record<
      string,
      unknown
    >

    candidats.push({
      status: enNombre(o.statusCode) ?? enNombre(o.status) ?? enNombre(reponse.status),
      name: typeof o.name === 'string' ? o.name : '',
      code: typeof o.code === 'string' ? o.code : '',
      message: typeof o.message === 'string' ? o.message : '',
      type:
        lireTypeFournisseur(o) ||
        lireTypeFournisseur(lireCorps(o.responseBody)) ||
        lireTypeFournisseur(enObjet(donnees)) ||
        lireTypeFournisseur(enObjet(o.data)),
      texte: [
        typeof o.message === 'string' ? o.message : '',
        enTexte(o.responseBody),
        enTexte(donnees.error),
      ]
        .join(' ')
        .toLowerCase(),
    })

    if (profondeur < 4) {
      file.push({ valeur: o.cause, profondeur: profondeur + 1 })
      file.push({ valeur: o.lastError, profondeur: profondeur + 1 })
      // Erreur en flux Anthropic : `{ type: 'error', error: { type, message } }`.
      if (typeof o.error === 'object' || typeof o.error === 'string') {
        file.push({ valeur: o.error, profondeur: profondeur + 1 })
      }
      if (Array.isArray(o.errors)) {
        for (const e of o.errors.slice(0, 3)) file.push({ valeur: e, profondeur: profondeur + 1 })
      }
    }
  }
  return candidats
}

const MARQUEUR_CLE_ABSENTE =
  /api key is missing|missing api key|api key must be|loadapikey|no api key|clé.*(absente|manquante)/
const MARQUEUR_REFUS =
  /content[_ -]?filter|content[_ -]?policy|safety|refusal|refused|harm_category|prohibited_content|violates .*policy/
const MARQUEUR_QUOTA =
  /insufficient_quota|exceeded your current quota|credit balance|billing|insufficient_funds|out of credits|payment required|usage limit/
const MARQUEUR_TROP_LONG =
  /prompt is too long|context[_ -]?length|context window|maximum context|too many tokens|token limit|request[_ -]?too[_ -]?large|input is too long|input too long|payload too large/
const MARQUEUR_DELAI = /timeout|timed out|etimedout|deadline exceeded|headers_timeout|body_timeout/
const MARQUEUR_RESEAU =
  /econnrefused|enotfound|econnreset|eai_again|fetch failed|cannot connect|network error|socket hang up|overloaded/

/** Classe une erreur quelconque en code stable, statut HTTP et possibilité de réessayer. */
export function classerErreur(error: unknown): ClassementErreur {
  if (error instanceof ErreurFournisseurAbsent) return classement('fournisseur_non_configure')

  const candidats = collecterCandidats(error)
  if (candidats.length === 0) return classement('interne')

  const noms = candidats.map(c => c.name)
  const codes = candidats.map(c => c.code)
  const texte = candidats.map(c => c.texte).join(' | ')
  const statuts = candidats.map(c => c.status).filter((s): s is number => s !== undefined)
  const statut = statuts[0]
  const types = candidats.map(c => c.type).filter(t => t !== '')

  // 1. Fournisseur ou clé absents : problème de configuration, pas de la requête.
  if (
    noms.includes('ErreurFournisseurAbsent') ||
    noms.some(n => /loadapikey/i.test(n)) ||
    MARQUEUR_CLE_ABSENTE.test(texte)
  ) {
    return classement('fournisseur_non_configure')
  }

  // 2. Annulation volontaire (l'utilisateur ferme ou arrête) ; un TimeoutError est un délai.
  if (noms.includes('TimeoutError')) return classement('delai_depasse')
  if (
    noms.some(n => n === 'AbortError' || n === 'ResponseAborted') ||
    codes.includes('ABORT_ERR')
  ) {
    return classement('annule')
  }

  // 3. Refus de sécurité du modèle.
  if (MARQUEUR_REFUS.test(texte) && (statut === undefined || statut === 400 || statut === 422)) {
    return classement('contenu_refuse')
  }

  // 4. Quota ou crédits épuisés (distinct d'une simple limite de débit).
  if (statuts.includes(402) || (MARQUEUR_QUOTA.test(texte) && !statuts.includes(401))) {
    return classement('quota_epuise')
  }

  // 5. Contexte dépassé.
  if (statuts.includes(413) || MARQUEUR_TROP_LONG.test(texte)) {
    return classement('requete_trop_longue')
  }

  // 5 bis. Erreur de NOTRE côté (requête, schéma d'outil ou message mal formé) : jamais une
  // indisponibilité du fournisseur, même si le texte évoque un réseau ou une surcharge.
  if (
    types.some(t => t === 'invalid_request_error' || t === 'not_found_error') ||
    (statut !== undefined && (statut === 400 || statut === 404 || statut === 422))
  ) {
    return classement('interne')
  }

  // 6. Authentification auprès du fournisseur : configuration serveur, jamais renvoyée telle quelle.
  if (
    statuts.some(s => s === 401 || s === 403) ||
    types.some(t => t === 'authentication_error' || t === 'permission_error')
  ) {
    return classement('authentification_fournisseur')
  }

  // 7. Limite de débit.
  if (statuts.includes(429) || types.includes('rate_limit_error')) return classement('limite_debit')

  // 8. Délais.
  if (
    statuts.some(s => s === 408 || s === 504) ||
    types.includes('timeout_error') ||
    codes.some(c => /timeout|etimedout/i.test(c)) ||
    MARQUEUR_DELAI.test(texte)
  ) {
    return classement('delai_depasse')
  }

  // 8 bis. Certificat TLS non reconnu : le fournisseur reste « indisponible » pour l'utilisateur,
  // mais inutile de reprendre, l'échec est identique à chaque essai.
  if (estErreurCertificat(error)) {
    return { ...CLASSEMENTS.fournisseur_indisponible, retentable: false }
  }

  // 9. Fournisseur injoignable ou surchargé.
  if (
    statuts.some(s => s === 502 || s === 503 || s === 529) ||
    types.some(t => t === 'overloaded_error' || t === 'api_error') ||
    MARQUEUR_RESEAU.test(texte)
  ) {
    return classement('fournisseur_indisponible')
  }

  // 10. Autres erreurs 5xx du fournisseur : internes, mais un nouvel essai peut aboutir.
  if (statuts.some(s => s >= 500)) return { ...CLASSEMENTS.interne, retentable: true }

  return classement('interne')
}

/**
 * Codes de cause d'un certificat TLS refusé (pare-feu ou proxy qui inspecte le trafic,
 * certificat expiré) : un nouvel essai échoue à l'identique.
 */
const CODES_CERTIFICAT = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

/** Vrai si une erreur (ou l'une de ses causes) vient d'un certificat TLS non reconnu. */
export function estErreurCertificat(error: unknown): boolean {
  if (CODES_CERTIFICAT.has(lireCodeReseauCause(error))) return true
  return collecterCandidats(error).some(c => CODES_CERTIFICAT.has(c.code))
}

/** Chaîne envoyée dans le flux UI : uniquement le code, jamais de détail du fournisseur. */
export function formaterErreurFlux(error: unknown): string {
  return `${MESSAGE_ERREUR_FLUX_PREFIXE}${classerErreur(error).code}`
}

/** Masque clés, jetons et en-têtes d'autorisation d'un texte destiné au journal. */
export function masquerSecrets(texte: string): string {
  return texte
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, '[masqué]')
    .replace(
      /(x-api-key|authorization|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
      '$1$2[masqué]'
    )
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, '[masqué]')
    .replace(/[A-Za-z0-9]{32,}/g, '[masqué]')
}

/** Code réseau Node (`ECONNRESET`, `UND_ERR_SOCKET`...) : majuscules, chiffres, soulignés. */
const FORME_CODE_RESEAU = /^[A-Z][A-Z0-9_]{1,39}$/

/**
 * Premier code réseau trouvé dans les causes imbriquées (3 niveaux, 3 erreurs agrégées par
 * niveau au plus). Seul un code de forme stricte sort : jamais de message, d'URL ni de clé.
 */
export function lireCodeReseauCause(error: unknown): string {
  const vus = new Set<unknown>()
  let niveau: unknown[] = [enObjet(error)?.cause]
  for (let profondeur = 0; profondeur < 3 && niveau.length > 0; profondeur++) {
    const suivant: unknown[] = []
    for (const valeur of niveau) {
      const o = enObjet(valeur)
      if (!o || vus.has(o)) continue
      vus.add(o)
      if (typeof o.code === 'string') {
        const code = masquerSecrets(o.code.trim())
        if (FORME_CODE_RESEAU.test(code)) return code
      }
      suivant.push(o.cause)
      if (Array.isArray(o.errors)) suivant.push(...o.errors.slice(0, 3))
    }
    niveau = suivant
  }
  return ''
}

/**
 * Description d'une erreur sur UNE ligne pour `console.error` : code, statut, nature, type du
 * fournisseur, cause et message tronqué. Jamais de clé, d'en-tête, de corps de requête ni d'URL.
 */
export function decrireErreurPourJournal(error: unknown): string {
  const c = classerErreur(error)
  const candidats = collecterCandidats(error)
  const statut = candidats.map(x => x.status).find((s): s is number => s !== undefined)
  const typeFournisseur = candidats.map(x => x.type).find(t => t !== '')
  const racine = enObjet(error)
  const nom =
    (typeof racine?.name === 'string' && racine.name) || candidats[0]?.name || typeof error
  const cause = enObjet(racine?.cause)
  const nomCause = typeof cause?.name === 'string' ? cause.name : ''
  const codeCause = lireCodeReseauCause(error)
  const brut =
    typeof error === 'string'
      ? error
      : typeof racine?.message === 'string' && racine.message
        ? racine.message
        : (candidats.find(x => x.message.trim() !== '')?.message ?? '')
  const message = masquerSecrets(brut.replace(/\s+/g, ' ').trim()).slice(0, 200)

  const champs = [
    `code=${c.code}`,
    statut !== undefined ? `statut=${statut}` : '',
    `retentable=${c.retentable ? 'oui' : 'non'}`,
    `nom=${masquerSecrets(String(nom))}`,
    typeFournisseur ? `typeFournisseur=${masquerSecrets(typeFournisseur)}` : '',
    nomCause ? `cause=${masquerSecrets(nomCause)}` : '',
    codeCause ? `codeCause=${codeCause}` : '',
    `message=${JSON.stringify(message)}`,
  ]
  return champs.filter(Boolean).join(' ')
}
