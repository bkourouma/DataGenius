/**
 * Briques communes des schémas : identifiants, périodes, cellules et surtout les
 * textes « sûrs » produits par le modèle.
 *
 * Règle (§3) : un artefact ne contient ni HTML, ni JS, ni URL externe. Les textes
 * libres (titres, libellés, markdown) refusent donc :
 * - les URL externes : http(s)://, ftp://, www., toute adresse « //... » ;
 * - les schémas actifs : javascript:, vbscript:, file: et data: suivi d'un type MIME
 *   (data:text/html...) ; « Tel: 06 12 » ou « Data: ventes » restent permis ;
 * - les balises HTML (« < » immédiatement suivi d'une lettre, de « / », « ! » ou « ? ») ;
 * - toute référence de caractère (« &#... » et « &nom; » comme &sol; ou &bsol;), qui sert à
 *   masquer un motif (« /&sol;evil.com » devient « //evil.com » après analyse markdown) ;
 * - les caractères de contrôle (hors tabulation et retours à la ligne).
 * Le markdown n'accepte de plus que des liens internes : la cible commence par un
 * seul « / » (jamais « // » ni « /\ »), sans barre oblique inverse, hors /api/ ; les
 * images markdown sont refusées.
 *
 * La vérification passe par un `superRefine` : elle tourne à la validation (y compris
 * celle que le SDK IA applique aux entrées d'outils), mais n'apparaît pas dans le JSON
 * Schema envoyé au modèle. Chaque `.describe()` concerné énonce donc la règle en clair.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Détection des contenus interdits
// ---------------------------------------------------------------------------

/** Raisons de refus d'un texte libre. */
export type MotifTexteRefuse =
  | 'url_externe'
  | 'schema_actif'
  | 'balise_html'
  | 'entite_numerique'
  | 'caractere_controle'
  | 'lien_non_interne'
  | 'image_markdown'
  | 'retour_ligne'

const RE_URL_SCHEMA = /\b(?:https?|ftps?|wss?):/i
const RE_WWW = /\bwww\./i
const RE_DOUBLE_BARRE = /\/\/|\/\\/
const RE_SCHEMA_ACTIF = /\b(?:javascript|vbscript)\s*:|\bfile:|\bdata:[a-z]+\//i
const RE_BALISE = /<[a-z!?/]/i
const RE_ENTITE_NUMERIQUE = /&#|&[A-Za-z][A-Za-z0-9]*;/
// eslint-disable-next-line no-control-regex
const RE_CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const RE_RETOUR_LIGNE = /[\r\n]/
const RE_IMAGE_MARKDOWN = /!\[/
/** Cible d'un lien en ligne : [texte](cible ...). */
const RE_LIEN_EN_LIGNE = /\]\(\s*<?([^)\s>]*)/g
/** Cible d'une définition de lien : [ref]: cible. */
const RE_DEFINITION_LIEN = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*<?([^\s>]*)/gm

/**
 * Vrai si `cible` est un chemin interne de Data Genius : un seul « / » en tête, pas de
 * « // », pas de barre oblique inverse, pas d'espace, hors API.
 */
export function estCheminInterne(cible: string): boolean {
  if (!cible.startsWith('/')) return false
  if (cible.startsWith('//') || cible.startsWith('/\\')) return false
  if (/[\s\\]/.test(cible) || RE_CONTROLE.test(cible)) return false
  if (/^\/api(?:\/|$|\?|#)/i.test(cible)) return false
  return true
}

/**
 * Motif qui fait refuser un texte libre, ou null s'il est accepté.
 * `markdown` : le texte est du markdown (liens internes permis, retours à la ligne
 * permis) ; sinon c'est un texte d'une ligne (titre, libellé).
 */
export function motifTexteRefuse(
  texte: string,
  options: { markdown?: boolean; multiligne?: boolean } = {}
): MotifTexteRefuse | null {
  if (RE_CONTROLE.test(texte)) return 'caractere_controle'
  if (!options.markdown && !options.multiligne && RE_RETOUR_LIGNE.test(texte)) {
    return 'retour_ligne'
  }
  if (RE_SCHEMA_ACTIF.test(texte)) return 'schema_actif'
  if (RE_URL_SCHEMA.test(texte) || RE_WWW.test(texte)) return 'url_externe'
  if (RE_BALISE.test(texte)) return 'balise_html'
  if (RE_ENTITE_NUMERIQUE.test(texte)) return 'entite_numerique'
  if (options.markdown) {
    if (RE_IMAGE_MARKDOWN.test(texte)) return 'image_markdown'
    for (const re of [RE_LIEN_EN_LIGNE, RE_DEFINITION_LIEN]) {
      for (const m of texte.matchAll(re)) {
        if (!estCheminInterne(m[1] ?? '')) return 'lien_non_interne'
      }
    }
  }
  // Après les liens : « //... » hors d'un lien reste une adresse externe.
  if (RE_DOUBLE_BARRE.test(texte)) return 'url_externe'
  return null
}

/** Message renvoyé au modèle pour chaque motif : il doit lui permettre de corriger. */
const MESSAGES_REFUS: Record<MotifTexteRefuse, string> = {
  url_externe:
    'Texte refusé : il contient une adresse externe (http://, https://, www. ou //). Aucune URL externe n’est permise.',
  schema_actif:
    'Texte refusé : il contient un schéma interdit (javascript:, vbscript:, file:, data:type/sous-type).',
  balise_html:
    'Texte refusé : il contient une balise HTML (« < » suivi d’une lettre, de « / », « ! » ou « ? »). Écrire « inférieur à », ou mettre une espace après « < ».',
  entite_numerique:
    'Texte refusé : les références de caractères (« &#… » et « &nom; ») sont interdites.',
  caractere_controle: 'Texte refusé : il contient des caractères de contrôle.',
  lien_non_interne:
    'Texte refusé : un lien markdown doit viser une page interne de Data Genius, commençant par un seul « / » (ex. /tableaux), hors /api/.',
  image_markdown: 'Texte refusé : les images markdown (![...](...)) sont interdites.',
  retour_ligne: 'Texte refusé : ce champ tient sur une seule ligne.',
}

function verifierTexte(options: { markdown?: boolean; multiligne?: boolean }) {
  return (valeur: string, ctx: z.RefinementCtx) => {
    const motif = motifTexteRefuse(valeur, options)
    if (motif) ctx.addIssue({ code: 'custom', message: MESSAGES_REFUS[motif], params: { motif } })
  }
}

const REGLE_TEXTE =
  'Texte brut : ni URL externe (http, https, www, //), ni HTML, ni référence de caractère (&…;), ni javascript:/data:.'

/**
 * Texte libre d'une ligne (titre, libellé), borné à `max` caractères.
 * La description passée est complétée de la règle anti-URL/HTML.
 */
export function texteSurSchema(max: number, description: string, min = 1) {
  return z
    .string()
    .min(min)
    .max(max)
    .superRefine(verifierTexte({}))
    .describe(`${description} ${max} caractères au plus, une seule ligne. ${REGLE_TEXTE}`)
}

/** Texte libre sur plusieurs lignes, sans markdown (description de tâche, message). */
export function texteMultiligneSurSchema(max: number, description: string, min = 1) {
  return z
    .string()
    .min(min)
    .max(max)
    .superRefine(verifierTexte({ multiligne: true }))
    .describe(`${description} ${max} caractères au plus. ${REGLE_TEXTE}`)
}

/** Markdown (GFM) sûr : liens internes seulement, sans image ni HTML. */
export function markdownSurSchema(max: number, description: string) {
  return z
    .string()
    .min(1)
    .max(max)
    .superRefine(verifierTexte({ markdown: true }))
    .describe(
      `${description} Markdown GFM (titres, listes, gras, tableaux GFM courts), ${max} caractères au plus. ` +
        'Liens internes seulement, de la forme [texte](/chemin) avec un seul « / » en tête (ex. [Rapports ventes](/rapports-ventes)). ' +
        'Interdits : URL externe (http, https, www, //), HTML, images, javascript:/data:. ' +
        'Ne jamais recopier de chiffre calculé : les chiffres viennent des tableaux et graphiques liés au jeu de données.'
    )
}

// ---------------------------------------------------------------------------
// Briques simples
// ---------------------------------------------------------------------------

/** Identifiant d'enregistrement (cuid de Prisma ou équivalent). */
export const IdentifiantSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)
  .describe(
    'Identifiant technique d’un enregistrement Data Genius (tel que renvoyé par un outil). Ne jamais l’inventer ni l’afficher à l’utilisateur.'
  )

/** Période mensuelle `YYYY-MM`, le format de SortiesLocales.period. */
export const PeriodeMoisSchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)
  .describe('Mois au format AAAA-MM, par exemple 2026-09 pour septembre 2026.')

/** Date civile `YYYY-MM-DD`. */
export const DateCivileSchema = z.iso.date().describe('Date au format AAAA-MM-JJ.')

/** Horodatage ISO 8601 (sortie serveur, `Date.toISOString()`). */
export const HorodatageSchema = z.iso.datetime({ offset: true })

/**
 * Clé de colonne d'un jeu de données (identifiant SQL simple : lettres, chiffres,
 * soulignés). Les clés de mesures et de dimensions du catalogue suivent la même règle.
 */
export const CleColonneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .describe(
    'Clé de colonne du jeu de données référencé (ex. ca_eur, pays, periode), telle que listée dans ses colonnes.'
  )

/** Valeur scalaire d'un filtre. */
export const ScalaireSchema = z.union([z.string().max(500), z.number(), z.boolean()])
export type Scalaire = z.infer<typeof ScalaireSchema>

/** Valeur d'une cellule d'un jeu de données. */
export const CelluleSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type Cellule = z.infer<typeof CelluleSchema>

/** Ligne d'un jeu de données : clé de colonne → valeur. */
export type LigneJeu = Record<string, Cellule>

/** Chemin interne de Data Genius (lien vers un écran), validé par estCheminInterne. */
export const CheminInterneSchema = z.string().min(1).max(500).refine(estCheminInterne, {
  error: 'Le lien doit être un chemin interne commençant par un seul « / », hors /api/.',
})

/** Lien vers un écran de Data Genius. */
export const LienInterneSchema = z.object({
  href: CheminInterneSchema,
  libelle: texteSurSchema(80, 'Libellé du lien.'),
})
export type LienInterne = z.infer<typeof LienInterneSchema>

/** Personne citée dans un DTO : on affiche toujours le nom, jamais l'id. */
export interface PersonneDto {
  id: string
  nom: string
  email?: string
}

/** Erreur d'API, au format { error, message } des routes voisines. */
export interface ErreurApi {
  error: string
  message: string
  /** Détail de validation zod (`z.flattenError`), le cas échéant. */
  details?: unknown
}

/** Page d'une liste paginée par curseur. */
export interface PageCurseur<T> {
  elements: T[]
  /** Curseur à repasser en `?curseur=` pour la page suivante ; null à la fin. */
  suivant: string | null
}
