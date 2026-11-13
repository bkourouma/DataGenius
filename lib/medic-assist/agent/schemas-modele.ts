/**
 * Schémas d'entrée des outils TELS QUE LE MODÈLE LES VOIT, et validation complète côté serveur.
 *
 * Constat (02/11/2026) : les JSON Schema générés tels quels à partir des contrats pesaient
 * ≈ 81 000 caractères pour les 10 premiers outils (≈ 23 000 jetons à 3,5 caractères par jeton, ≈ 47 000
 * mesurés), réécrits en cache à chaque nouvelle conversation. La règle anti-URL/HTML répétée sur
 * chaque texte, les descriptions longues, les expressions régulières et les bornes y pesaient
 * plus que la structure. Après compactage : ≈ 18 400 caractères pour les définitions complètes (nom,
 * description et schéma des 10 outils, dont ≈ 15 200 pour les seuls schémas), soit ≈ 5 300 jetons estimés ;
 * borné par tests/unit/medic-assist/lot1/outils/schemas-modele.test.ts.
 *
 * Principe :
 * - la STRUCTURE envoyée au modèle est dérivée automatiquement du contrat (`z.toJSONSchema`,
 *   même conversion que le SDK) : propriétés, champs obligatoires, énumérations, constantes
 *   (écrites `enum` à une valeur, mieux tolérées par Gemini), unions et types restent ceux du contrat, sans recopie à maintenir ;
 * - les ANNOTATIONS sont élaguées : plus de `pattern`, de longueurs, de `$schema` ni de
 *   `propertyNames` ; les descriptions du contrat sont remplacées par les textes courts de
 *   `DESCRIPTIONS`, une seule fois par notion ; les règles communes (textes sûrs, formats,
 *   jeuDeDonneesId) sont dites une fois dans la description de l'outil (outils.ts) ;
 * - deux RENVOIS évitent d'envoyer deux fois la même forme : modifier_artefact.spec renvoie à
 *   creer_artefact.spec, et la spec d'un bloc graphique ou tableau d'un document renvoie à
 *   l'artefact du même type (voir `renvoiPour`) ;
 * - la VALIDATION reste celle du contrat complet : `validate` exécute le schéma zod du contrat
 *   (refine et superRefine compris), comme le faisait le SDK avec le schéma zod passé tel quel.
 *   Rien n'est assoupli côté serveur : une entrée refusée hier l'est encore, avec le même
 *   message d'erreur rendu au modèle.
 *
 * Contraintes du SDK v7 respectées : racine objet, `additionalProperties: false` sur chaque
 * objet (sauf `z.record`), ni transform, ni default, ni coerce (les contrats n'en ont pas).
 */

import { jsonSchema, type JSONSchema7, type Schema } from 'ai'
import { z } from 'zod'

import {
  SCHEMAS_ENTREE_OUTILS,
  type EntreeOutil,
  type NomOutil,
} from '@/lib/medic-assist/contrats'

type Json = Record<string, unknown>

/** Mots-clés de structure gardés tels quels ; tout autre mot-clé est retiré. */
const MOTS_CLES_GARDES = new Set([
  'type',
  'enum',
  'required',
  'format',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
])

/** Au-delà, une borne de tableau n'aide pas le modèle (ex. 200 ids) : le serveur la garde. */
const BORNE_TABLEAU_UTILE_MAX = 12

/**
 * Descriptions courtes, par outil. Clé : suffixe du chemin de propriétés (noms séparés par des
 * points, sans les niveaux d'union ni de tableau) ; le suffixe le plus long l'emporte ; une clé
 * « ^chemin » ne vise que ce chemin depuis la racine. Une propriété sans entrée n'a pas de
 * description (son nom et son énumération suffisent).
 */
export const DESCRIPTIONS: Record<NomOutil, Record<string, string>> = {
  catalogue_donnees: {},
  rechercher_entites: {
    texte: 'Nom, code ou fragment (sans casse ni accents).',
    types: 'Absent : tous.',
    limite: 'Absent : 10.',
  },
  interroger_donnees: {
    mesures: 'Clés de mesures du jeu, ex. montant_total, nombre_lignes (voir catalogue_donnees).',
    dimensions: 'Clés de regroupement, ex. categorie, region, periode. Absent : une ligne de totaux.',
    filtres:
      'Les *Ids viennent de rechercher_entites. Le périmètre de l’utilisateur s’ajoute toujours.',
    'filtres.periode':
      'Absente : défaut du jeu (dernier mois complet ; jeu sans calendrier : tout l’historique, à éviter).',
    debut: 'AAAA-MM inclus.',
    fin: 'AAAA-MM inclus.',
    exercice: 'Année de début : 2026 = avril 2026 à mars 2027.',
    statuts: 'Valeurs listées par catalogue_donnees.',
    recherche: 'Texte cherché dans les libellés.',
    autres: 'Filtres propres au jeu déclarés par catalogue_donnees : clé → valeur ou liste.',
    limite: 'Lignes au plus après tri, ex. 10 pour un Top 10.',
    granularite: 'Pas de temps de la dimension periode (trimestre, annee : civils).',
  },
  requete_sql: {
    sql: 'Un seul SELECT (WITH permis) sur les vues mv_* du catalogue ; ni point-virgule, ni schéma, ni commentaire. Alias snake_case. Périmètre, LIMIT et délai de 15 s imposés par le serveur.',
    objectif: 'Ce que calcule la requête, en une phrase (montré à l’utilisateur).',
  },
  resume_mensuel: {
    periode: 'Mois complet AAAA-MM ; absent : dernier mois complet. Le mois en cours est refusé.',
    paysId: 'Id de pays (rechercher_entites) ; absent : tout le périmètre.',
  },
  lire_piece_jointe: {
    pieceJointeId: 'Id listé avec le message de l’utilisateur.',
    feuille: 'Classeur : feuille ; absente : la première.',
    plage: 'Classeur : plage, ex. A1:H200 ; absente : zone utilisée.',
  },
  creer_artefact: {
    jeuDeDonneesId: 'Id d’un jeu de cette conversation.',
    'spec.colonnes': 'Absentes : toutes, dans l’ordre du jeu.',
    'filtres.valeur': 'Liste pour parmi, [min, max] pour entre.',
    pivot: 'Tableau croisé facultatif.',
    totaux: 'Ligne de totaux (colonnes additives).',
    'graphique.x': 'Dimension en abscisse (nuage : mesure).',
    'graphique.y':
      'Mesures. Une seule pour secteurs, anneau, treemap, entonnoir, jauge, carte_chaleur ; deux au moins pour combine.',
    'graphique.serie': 'Dimension qui éclate en séries ; obligatoire pour carte_chaleur.',
    'y.forme': 'Pour combine.',
    'y.axe': 'droite : autre échelle (taux).',
    'graphique.limite': 'Catégories affichées au plus.',
    ligne: 'Rang (0 = première) ou {cle, valeur} ; absente : total du jeu.',
    comparaison: 'Référence affichée en variation (ex. N-1).',
    objectif: 'Objectif (ex. budget) : taux et badge Atteint.',
    blocs: 'texte (markdown), artefact (id existant), graphique ou tableau (spec sans type).',
    markdown: 'GFM ; liens internes [texte](/chemin) seulement ; aucun chiffre recopié.',
    'blocs.artefactId': 'Id d’un artefact de cette conversation.',
  },
  modifier_artefact: { artefactId: 'Id renvoyé par creer_artefact.' },
  proposer_action: {
    parametres:
      'Objet du type choisi ; branches dans l’ordre creer_tache, envoyer_email, notifier, programmer_rapport.',
    titre: 'À l’infinitif.',
    jourSemaine: 'Si hebdomadaire : 1 = lundi … 7 = dimanche.',
    jourMois: 'Si mensuel.',
    heure: 'HH:MM, heure du serveur.',
  },
  proposer_relances: {
    questions: 'Questions courtes, comme l’utilisateur les poserait, dans sa langue.',
  },
  preparer_alerte: {
    type: 'Type d’alerte du catalogue.',
    parametres:
      'Seulement ce que l’utilisateur demande : paysIds, produitIds, seuilPourcent, seuil, joursAvant, joursMax, comparaison, mesure, periode... Les ids viennent de rechercher_entites.',
  },
}


/** JSON Schema d'entrée du contrat, par la même conversion que le SDK (provider-utils). */
export function schemaJsonContrat(nom: NomOutil): Json {
  return z.toJSONSchema(SCHEMAS_ENTREE_OUTILS[nom], {
    target: 'draft-7',
    io: 'input',
    reused: 'inline',
  }) as Json
}

/** Marqueurs de chemin qui ne sont pas des noms de propriété (union, élément, record). */
const MARQUEURS = new Set(['|', '[]', '*'])

/**
 * Description courte d'un nœud. Un élément de tableau, une branche d'union ou la valeur d'un
 * record n'en reçoit pas (celle du parent suffit). Une clé « ^chemin » vise le chemin entier
 * depuis la racine ; sinon le plus long suffixe connu l'emporte.
 */
function descriptionPour(chemin: string[], descriptions: Record<string, string>): string | null {
  const dernier = chemin[chemin.length - 1]
  if (dernier !== undefined && MARQUEURS.has(dernier)) return null
  const noms = chemin.filter(p => !MARQUEURS.has(p))
  const ancre = `^${noms.join('.')}`
  if (Object.prototype.hasOwnProperty.call(descriptions, ancre)) return descriptions[ancre] ?? null
  for (let debut = 0; debut <= noms.length; debut++) {
    const cle = noms.slice(debut).join('.')
    if (Object.prototype.hasOwnProperty.call(descriptions, cle)) return descriptions[cle] ?? null
  }
  return null
}

function estObjetJson(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Sous-schémas remplacés par un renvoi (objet sans propriétés, description qui nomme la forme
 * déjà montrée) : la même structure n'est pas envoyée deux fois. Le serveur valide toujours la
 * forme complète du contrat.
 * - modifier_artefact.spec : la spécification de creer_artefact.spec, montrée dans le même appel ;
 * - bloc graphique ou tableau d'un document : les champs de l'artefact du même type, montrés dans
 *   la même union.
 */
function renvoiPour(outil: NomOutil, chemin: string[], nom: string, parent: Json): Json | null {
  if (outil === 'modifier_artefact' && chemin.length === 0 && nom === 'spec') {
    return {
      type: 'object',
      description:
        'Spécification COMPLÈTE de la nouvelle version, de même forme que creer_artefact.spec (le type peut changer).',
    }
  }
  const type = (estObjetJson(parent.properties) && estObjetJson(parent.properties.type)
    ? parent.properties.type.const
    : undefined) as unknown
  if (nom === 'spec' && chemin.includes('blocs') && (type === 'graphique' || type === 'tableau')) {
    return { type: 'object', description: `Champs de l’artefact ${type}, sans type.` }
  }
  return null
}

/** Mots-clés qui portent la structure d'un nœud (les autres sont des annotations). */
const STRUCTURE = ['type', 'enum', 'const', 'required', 'properties', 'items', 'anyOf', 'oneOf']

/**
 * Une branche qui n'est elle-même qu'une union (ex. scalaire = texte, nombre ou booléen, dans
 * « valeur ou liste ») est mise à plat : même ensemble de valeurs, un niveau de moins.
 */
function aplatirUnion(branches: unknown[], cle: 'anyOf' | 'oneOf'): unknown[] {
  return branches.flatMap(b =>
    estObjetJson(b) &&
    Array.isArray(b[cle]) &&
    Object.keys(b).filter(k => STRUCTURE.includes(k)).join() === cle
      ? aplatirUnion(b[cle] as unknown[], cle)
      : [b]
  )
}

interface Elagage {
  outil: NomOutil
  descriptions: Record<string, string>
}

/** Élague un nœud : structure gardée, annotations retirées, description courte posée. */
function elaguer(noeud: Json, chemin: string[], e: Elagage): Json {
  const sortie: Json = {}
  const description = descriptionPour(chemin, e.descriptions)
  if (description) sortie.description = description

  for (const [cle, valeur] of Object.entries(noeud)) {
    if (cle === 'properties' && estObjetJson(valeur)) {
      const proprietes: Json = {}
      for (const [nom, sous] of Object.entries(valeur)) {
        if (!estObjetJson(sous)) continue
        proprietes[nom] = renvoiPour(e.outil, chemin, nom, noeud) ?? elaguer(sous, [...chemin, nom], e)
      }
      sortie.properties = proprietes
    } else if (cle === 'items' && estObjetJson(valeur)) {
      sortie.items = elaguer(valeur, [...chemin, '[]'], e)
    } else if ((cle === 'anyOf' || cle === 'oneOf') && Array.isArray(valeur)) {
      sortie[cle] = aplatirUnion(valeur, cle).map(v =>
        estObjetJson(v) ? elaguer(v, [...chemin, '|'], e) : v
      )
    } else if (cle === 'additionalProperties') {
      sortie.additionalProperties = estObjetJson(valeur)
        ? elaguer(valeur, [...chemin, '*'], e)
        : valeur
    } else if (cle === 'const') {
      // `enum` à une valeur : équivalent à `const`, mieux toléré par les outils Gemini.
      sortie.enum = [valeur]
    } else if (cle === 'maxItems' && typeof valeur === 'number') {
      if (valeur <= BORNE_TABLEAU_UTILE_MAX) sortie.maxItems = valeur
    } else if (MOTS_CLES_GARDES.has(cle)) {
      sortie[cle] = valeur
    }
  }

  // Objet fermé, comme le SDK le force pour un schéma zod (sauf un z.record).
  if (sortie.type === 'object' && sortie.properties && sortie.additionalProperties === undefined) {
    sortie.additionalProperties = false
  }
  return sortie
}

/** Schéma compact montré au modèle pour l'outil `nom` (dérivé du contrat, mis en cache). */
const cacheCompacts = new Map<NomOutil, JSONSchema7>()
export function schemaModele(nom: NomOutil): JSONSchema7 {
  const deja = cacheCompacts.get(nom)
  if (deja) return deja
  const compact = elaguer(schemaJsonContrat(nom), [], {
    outil: nom,
    descriptions: DESCRIPTIONS[nom],
  }) as JSONSchema7
  cacheCompacts.set(nom, compact)
  return compact
}

/**
 * Schéma d'entrée passé à `tool({ inputSchema })` : JSON Schema compact pour le fournisseur,
 * validation par le schéma zod COMPLET du contrat (même résultat que zod4Schema du SDK).
 */
export function schemaEntreeOutil<K extends NomOutil>(nom: K): Schema<EntreeOutil<K>> {
  const contrat = SCHEMAS_ENTREE_OUTILS[nom] as unknown as z.ZodType<EntreeOutil<K>>
  return jsonSchema<EntreeOutil<K>>(() => schemaModele(nom), {
    validate: async valeur => {
      const r = await contrat.safeParseAsync(valeur)
      return r.success ? { success: true, value: r.data } : { success: false, error: r.error }
    },
  })
}

/**
 * Schéma d'entrée TOLÉRANT, passé à `tool({ inputSchema })` : même JSON Schema compact pour le
 * fournisseur, mais le SDK ne rejette plus rien. La validation complète (`validerEntreeOutil`)
 * est faite dans `execute`, où une saisie refusée devient un résultat d'outil rendu au modèle
 * (saisie-invalide.ts) au lieu d'un `tool-error` brut du SDK.
 */
export function schemaEntreeOutilTolerant<K extends NomOutil>(nom: K): Schema<unknown> {
  return jsonSchema<unknown>(() => schemaModele(nom), {
    validate: async valeur => ({ success: true, value: valeur }),
  })
}

/** Validation complète d'une entrée brute par le schéma zod du contrat (refine compris). */
export async function validerEntreeOutil<K extends NomOutil>(
  nom: K,
  valeur: unknown
): Promise<{ ok: true; entree: EntreeOutil<K> } | { ok: false; erreur: z.ZodError }> {
  const contrat = SCHEMAS_ENTREE_OUTILS[nom] as unknown as z.ZodType<EntreeOutil<K>>
  const r = await contrat.safeParseAsync(valeur)
  return r.success ? { ok: true, entree: r.data } : { ok: false, erreur: r.error }
}
