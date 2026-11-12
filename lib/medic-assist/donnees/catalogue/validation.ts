/**
 * Validation d'une requete semantique, en deux temps :
 *  1. la FORME (zod) : types, bornes des tableaux, limite <= 10 000 ;
 *  2. le CATALOGUE : jeu, mesures, dimensions, filtres declares, tri, granularite, periode.
 *
 * Toute cle inconnue donne une `ErreurDonnees` courte qui liste les valeurs possibles : le
 * modele corrige sa requete au tour suivant. Les messages ne citent que des cles du
 * catalogue, jamais le schema de la base.
 *
 * La periode est RESOLUE ici (bornes 'YYYY-MM' incluses) : explicite, exercice (avril ->
 * mars, `periodesExercice`), ou dernier mois clos (`moisParDefaut`, avec `maintenant` et
 * `jourLimite` du contexte, comme les ecrans de rapport).
 */

import { z } from 'zod'

import { moisParDefaut } from '@/lib/reports/plage-ventes-defaut'
import { MOIS_DEBUT_EXERCICE } from '@/lib/utils/exercice'

import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import type {
  FiltresSemantiques,
  RequeteSemantique,
} from '@/lib/medic-assist/donnees/requete-interne'
import {
  CLES_TEMPORELLES,
  GRANULARITES,
  bornesExerciceCalendaire,
  type Granularite,
  dimensionsDisponibles,
  dimensionsSelectionnees,
  estAuGrainDuMois,
} from '../moteur/temps'
import { ErreurDonnees, MAX_LIGNES_JEU } from '../types'
import { libelleComplet } from './communs'
import type {
  DefinitionFiltre,
  DefinitionJeu,
  DefinitionMesure,
  EntreeCatalogue,
  Registre,
  RequeteNormalisee,
} from './types'

/** Bornes de la forme d'une requete. */
export const BORNES_REQUETE = {
  mesures: 20,
  dimensions: 10,
  tri: 10,
  filtres: 30,
  /** Identifiants d'un filtre 'ids'. */
  ids: 500,
  longueurId: 100,
  /** Valeurs d'un filtre 'liste'. */
  liste: 100,
  longueurValeur: 100,
  texte: 200,
  limite: MAX_LIGNES_JEU,
  anneeMin: 2000,
  anneeMax: 2099,
} as const

export type SensTri = 'asc' | 'desc'

/**
 * Requete validee : la `RequeteNormalisee` du catalogue (ce que voit `lienEcran`), plus le
 * tri et la limite DEMANDES (le moteur complete le tri par defaut) et l'origine de la periode.
 */
export interface RequeteValidee extends RequeteNormalisee {
  /** Tri demande, cles verifiees, sans doublon ; vide = tri par defaut du moteur. */
  tri: { cle: string; sens: SensTri }[]
  /** Limite demandee (1 a 10 000) ; absente = defaut du moteur. */
  limite?: number
  /** Vrai quand la periode vient du defaut du jeu (aucune periode dans la requete). */
  periodeParDefaut: boolean
}

// ---------------------------------------------------------------------------
// 1. Forme (zod)
// ---------------------------------------------------------------------------

const CLES_RACINE = ['jeu', 'mesures', 'dimensions', 'filtres', 'tri', 'limite', 'granularite']

const schemaCle = z.string().trim().min(1).max(64)

const schemaRequete = z.strictObject({
  jeu: schemaCle,
  mesures: z.array(schemaCle).max(BORNES_REQUETE.mesures).nullish(),
  dimensions: z.array(schemaCle).max(BORNES_REQUETE.dimensions).nullish(),
  filtres: z.record(z.string(), z.unknown()).nullish(),
  tri: z
    .array(z.strictObject({ cle: schemaCle, sens: z.enum(['asc', 'desc']) }))
    .max(BORNES_REQUETE.tri)
    .nullish(),
  limite: z.number().int().min(1).max(BORNES_REQUETE.limite).nullish(),
  granularite: z.enum(GRANULARITES as [Granularite, ...Granularite[]]).nullish(),
})

const TYPES_FR: Record<string, string> = {
  string: 'texte',
  number: 'nombre',
  int: 'entier',
  boolean: 'booléen',
  array: 'liste',
  object: 'objet',
  record: 'objet',
}

/** Message francais court pour une anomalie zod (sans reprendre la valeur recue). */
function messageAnomalie(issue: z.core.$ZodIssue): string {
  const chemin = issue.path.map(String).join('.') || 'requête'
  const champs = issue as unknown as Record<string, unknown>
  switch (issue.code) {
    case 'unrecognized_keys': {
      const cles = (champs.keys as string[] | undefined) ?? []
      const possibles = issue.path.length === 0 ? CLES_RACINE : ['cle', 'sens']
      return `clé(s) non reconnue(s) dans ${chemin} : ${cles.join(', ')} (clés possibles : ${possibles.join(', ')})`
    }
    case 'invalid_type':
      return `${chemin} : ${TYPES_FR[String(champs.expected)] ?? String(champs.expected)} attendu`
    case 'too_big':
      return `${chemin} : au plus ${String(champs.maximum)}${champs.origin === 'array' ? ' éléments' : champs.origin === 'string' ? ' caractères' : ''}`
    case 'too_small':
      return `${chemin} : au moins ${String(champs.minimum)}${champs.origin === 'array' ? ' élément(s)' : champs.origin === 'string' ? ' caractère(s)' : ''}`
    case 'invalid_value':
      return `${chemin} : valeurs possibles ${((champs.values as unknown[]) ?? []).map(String).join(', ')}`
    default:
      return `${chemin} : valeur invalide`
  }
}

// ---------------------------------------------------------------------------
// 2. Catalogue
// ---------------------------------------------------------------------------

function listePossibles(cles: string[]): string {
  return cles.length > 0 ? cles.join(', ') : 'aucune'
}

function sansDoublon<T>(valeurs: readonly T[]): T[] {
  return Array.from(new Set(valeurs))
}

function trouverEntree(registre: Registre, cle: string): EntreeCatalogue {
  const entree = registre.find(e => e.jeu.cle === cle)
  if (!entree) {
    throw new ErreurDonnees(
      `Jeu inconnu "${cle}". Jeux possibles : ${listePossibles(registre.map(e => e.jeu.cle))}.`,
      'jeu_inconnu'
    )
  }
  return entree
}

function validerMesures(jeu: DefinitionJeu, cles: string[]): DefinitionMesure[] {
  return cles.map(cle => {
    const mesure = jeu.mesures.find(m => m.cle === cle)
    if (mesure) return mesure
    const indice = dimensionsDisponibles(jeu).some(d => d.cle === cle)
      ? ` ("${cle}" est une dimension : mettez-la dans dimensions.)`
      : ''
    throw new ErreurDonnees(
      `Mesure inconnue "${cle}" pour le jeu ${jeu.cle}. Mesures possibles : ${listePossibles(jeu.mesures.map(m => m.cle))}.${indice}`,
      'mesure_inconnue'
    )
  })
}

function validerDimensions(jeu: DefinitionJeu, cles: string[]): void {
  const disponibles = dimensionsDisponibles(jeu)
  for (const cle of cles) {
    if (disponibles.some(d => d.cle === cle)) continue
    const indice = jeu.mesures.some(m => m.cle === cle)
      ? ` ("${cle}" est une mesure : mettez-la dans mesures.)`
      : ''
    throw new ErreurDonnees(
      `Dimension inconnue "${cle}" pour le jeu ${jeu.cle}. Dimensions possibles : ${listePossibles(disponibles.map(d => d.cle))}.${indice}`,
      'dimension_inconnue'
    )
  }
}

function erreurFiltre(cle: string, attendu: string): ErreurDonnees {
  return new ErreurDonnees(`Filtre ${cle} : ${attendu}.`, 'filtre_invalide')
}

function validerListeDeTextes(
  cle: string,
  valeur: unknown,
  max: number,
  longueurMax: number,
  nature: string
): string[] {
  if (!Array.isArray(valeur)) throw erreurFiltre(cle, `${nature} attendue`)
  if (valeur.length === 0) {
    throw erreurFiltre(cle, `liste vide ; retirez le filtre ou donnez au moins un élément`)
  }
  if (valeur.length > max) throw erreurFiltre(cle, `au plus ${max} éléments`)
  for (const element of valeur) {
    if (
      typeof element !== 'string' ||
      element.trim().length === 0 ||
      element.length > longueurMax
    ) {
      throw erreurFiltre(
        cle,
        `chaque élément doit être un texte non vide d'au plus ${longueurMax} caractères`
      )
    }
  }
  return sansDoublon(valeur as string[])
}

function estDateIso(texte: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte)
  if (!m) return false
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(annee, mois - 1, jour))
  return (
    date.getUTCFullYear() === annee && date.getUTCMonth() === mois - 1 && date.getUTCDate() === jour
  )
}

/** Minuscules, sans accents ni espaces de bord : base de la comparaison tolerante des listes. */
function normaliserValeur(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

/** Synonymes francais evidents des statuts (cle normalisee -> valeur canonique). */
const SYNONYMES_STATUT: Readonly<Record<string, string>> = {
  actif: 'active',
  actifs: 'active',
  actives: 'active',
  active: 'active',
  inactif: 'inactive',
  inactifs: 'inactive',
  inactives: 'inactive',
  inactive: 'inactive',
  desactive: 'inactive',
}

/**
 * Valeur canonique de `valeursPossibles` correspondant a la saisie, ou null si inconnue.
 * Ordre : valeur exacte, puis casse/accents/espaces, puis synonyme de statut (seulement si
 * la valeur canonique figure dans la liste).
 */
function resoudreValeurPossible(valeur: string, possibles: readonly string[]): string | null {
  if (possibles.includes(valeur)) return valeur
  const normalisee = normaliserValeur(valeur)
  const parForme = possibles.find(p => normaliserValeur(p) === normalisee)
  if (parForme !== undefined) return parForme
  const canonique = SYNONYMES_STATUT[normalisee]
  if (canonique !== undefined && possibles.includes(canonique)) return canonique
  return null
}

/** Valide la valeur d'un filtre declare selon son type ; rend la valeur normalisee. */
function validerValeurFiltre(def: DefinitionFiltre, valeur: unknown): unknown {
  switch (def.type) {
    case 'ids':
      return validerListeDeTextes(
        def.cle,
        valeur,
        BORNES_REQUETE.ids,
        BORNES_REQUETE.longueurId,
        "liste d'identifiants"
      )
    case 'liste': {
      const valeurs = validerListeDeTextes(
        def.cle,
        valeur,
        BORNES_REQUETE.liste,
        BORNES_REQUETE.longueurValeur,
        'liste de valeurs'
      )
      const possibles = def.valeursPossibles
      if (possibles) {
        const resolues = valeurs.map(v => resoudreValeurPossible(v, possibles))
        const indexInconnue = resolues.findIndex(v => v === null)
        if (indexInconnue !== -1) {
          throw erreurFiltre(
            def.cle,
            `valeur inconnue "${valeurs[indexInconnue]}" ; valeurs possibles : ${listePossibles(possibles)}`
          )
        }
        return sansDoublon(resolues as string[])
      }
      return valeurs
    }
    case 'texte': {
      if (typeof valeur !== 'string') throw erreurFiltre(def.cle, 'texte attendu')
      const texte = valeur.trim()
      if (texte.length === 0 || texte.length > BORNES_REQUETE.texte) {
        throw erreurFiltre(
          def.cle,
          `texte non vide d'au plus ${BORNES_REQUETE.texte} caractères attendu`
        )
      }
      return texte
    }
    case 'nombre':
      if (typeof valeur !== 'number' || !Number.isFinite(valeur) || Math.abs(valeur) > 1e12) {
        throw erreurFiltre(def.cle, 'nombre attendu')
      }
      return valeur
    case 'booleen':
      if (typeof valeur !== 'boolean') throw erreurFiltre(def.cle, 'true ou false attendu')
      return valeur
    case 'date':
      if (typeof valeur !== 'string' || !estDateIso(valeur)) {
        throw erreurFiltre(def.cle, 'date YYYY-MM-DD attendue')
      }
      return valeur
    default:
      throw erreurFiltre(def.cle, 'type de filtre non pris en charge')
  }
}

const FORMES_PERIODE =
  "{debut: 'YYYY-MM', fin: 'YYYY-MM'}, {exercice: 2026} (année de début) ou {dernierMoisClos: true}"

function erreurPeriode(detail: string): ErreurDonnees {
  return new ErreurDonnees(
    `Période invalide : ${detail}. Formes possibles : ${FORMES_PERIODE}.`,
    'periode_invalide'
  )
}

const MOTIF_PERIODE = /^(\d{4})-(0[1-9]|1[0-2])$/

function validerMois(nom: string, valeur: unknown): string {
  if (typeof valeur !== 'string') throw erreurPeriode(`${nom} doit être un texte 'YYYY-MM'`)
  const m = MOTIF_PERIODE.exec(valeur)
  if (!m) throw erreurPeriode(`${nom} doit être au format 'YYYY-MM' (mois 01 à 12)`)
  const annee = Number(m[1])
  if (annee < BORNES_REQUETE.anneeMin || annee > BORNES_REQUETE.anneeMax) {
    throw erreurPeriode(
      `${nom} hors des années ${BORNES_REQUETE.anneeMin} à ${BORNES_REQUETE.anneeMax}`
    )
  }
  return valeur
}

function validerExercice(valeur: unknown): number {
  if (
    typeof valeur !== 'number' ||
    !Number.isInteger(valeur) ||
    valeur < BORNES_REQUETE.anneeMin ||
    valeur > BORNES_REQUETE.anneeMax
  ) {
    throw erreurPeriode(
      `exercice doit être une année entière de ${BORNES_REQUETE.anneeMin} à ${BORNES_REQUETE.anneeMax} (année de début)`
    )
  }
  return valeur
}

function memesCles(objet: Record<string, unknown>, cles: string[]): boolean {
  const presentes = Object.keys(objet)
  return presentes.length === cles.length && cles.every(c => presentes.includes(c))
}

/** Resout la periode effective d'une requete (bornes incluses), ou null. */
function resoudrePeriode(
  jeu: DefinitionJeu,
  brute: unknown,
  ctx: ContexteExecution
): { periode: RequeteNormalisee['periode']; parDefaut: boolean } {
  const absente = brute === undefined || brute === null
  if (!jeu.temps) {
    if (!absente) {
      throw new ErreurDonnees(
        `Le jeu ${jeu.cle} n'est pas daté : retirez le filtre periode.`,
        'periode_invalide'
      )
    }
    return { periode: null, parDefaut: false }
  }

  if (absente) {
    if (jeu.temps.defaut === 'dernier_mois_clos') {
      const mois = moisParDefaut(ctx.maintenant, ctx.jourLimite)
      return { periode: { debut: mois, fin: mois, origine: 'dernier_mois_clos' }, parDefaut: true }
    }
    return { periode: null, parDefaut: false }
  }

  if (typeof brute !== 'object' || Array.isArray(brute)) throw erreurPeriode('objet attendu')
  const objet = brute as Record<string, unknown>

  if (memesCles(objet, ['debut', 'fin'])) {
    const debut = validerMois('debut', objet.debut)
    const fin = validerMois('fin', objet.fin)
    if (debut > fin) throw erreurPeriode(`debut (${debut}) est après fin (${fin})`)
    return { periode: { debut, fin, origine: 'explicite' }, parDefaut: false }
  }
  if (memesCles(objet, ['exercice'])) {
    const exercice = validerExercice(objet.exercice)
    const { debut, fin } = bornesExerciceCalendaire(exercice, jeu.temps.calendrier?.moisDebutExercice ?? MOIS_DEBUT_EXERCICE)
    return {
      periode: {
        debut,
        fin,
        origine: 'exercice',
        exercice,
      },
      parDefaut: false,
    }
  }
  if (memesCles(objet, ['dernierMoisClos'])) {
    if (objet.dernierMoisClos !== true) throw erreurPeriode('dernierMoisClos doit valoir true')
    const mois = moisParDefaut(ctx.maintenant, ctx.jourLimite)
    return { periode: { debut: mois, fin: mois, origine: 'dernier_mois_clos' }, parDefaut: false }
  }
  throw erreurPeriode('clés non reconnues')
}

function validerFiltres(jeu: DefinitionJeu, bruts: Record<string, unknown>): FiltresSemantiques {
  const cles = Object.keys(bruts)
  if (cles.length > BORNES_REQUETE.filtres) {
    throw new ErreurDonnees(
      `Trop de filtres : au plus ${BORNES_REQUETE.filtres}.`,
      'requete_invalide'
    )
  }
  const filtres: FiltresSemantiques = {}
  for (const cle of cles) {
    if (cle === 'periode' && jeu.temps) continue
    const valeur = bruts[cle]
    if (valeur === undefined || valeur === null) continue
    const def = jeu.filtres.find(f => f.cle === cle)
    if (!def) {
      const possibles = [...(jeu.temps ? ['periode'] : []), ...jeu.filtres.map(f => f.cle)]
      throw new ErreurDonnees(
        `Filtre inconnu "${cle}" pour le jeu ${jeu.cle}. Filtres possibles : ${listePossibles(possibles)}.`,
        'filtre_inconnu'
      )
    }
    filtres[cle] = validerValeurFiltre(def, valeur)
  }
  return filtres
}

/**
 * Valide `requete` contre le catalogue et la resout. Leve `ErreurDonnees` (message court,
 * exploitable par le modele) a la premiere anomalie.
 */
export function validerRequete(
  requete: RequeteSemantique,
  ctx: ContexteExecution,
  registre: Registre
): { entree: EntreeCatalogue; normalisee: RequeteValidee } {
  const forme = schemaRequete.safeParse(requete)
  if (!forme.success) {
    const anomalies = forme.error.issues.slice(0, 3).map(messageAnomalie)
    throw new ErreurDonnees(`Requête invalide : ${anomalies.join(' ; ')}.`, 'requete_invalide')
  }
  const brute = forme.data

  const entree = trouverEntree(registre, brute.jeu)
  const jeu = entree.jeu

  const clesMesures = sansDoublon(brute.mesures ?? [])
  const mesures = validerMesures(jeu, clesMesures)

  const clesDimensions = sansDoublon(brute.dimensions ?? [])
  validerDimensions(jeu, clesDimensions)

  const granularite = brute.granularite ?? undefined
  if (granularite && !jeu.temps) {
    throw new ErreurDonnees(
      `Le jeu ${jeu.cle} n'est pas daté : retirez granularite.`,
      'requete_invalide'
    )
  }

  const dimensions = dimensionsSelectionnees(jeu, clesDimensions, granularite)
  if (mesures.length === 0 && dimensions.length === 0) {
    throw new ErreurDonnees(
      `Indiquez au moins une mesure, ou au moins une dimension pour une simple liste. Mesures possibles : ${listePossibles(jeu.mesures.map(m => m.cle))}.`,
      'requete_invalide'
    )
  }

  const filtresBruts = brute.filtres ?? {}
  const { periode, parDefaut } = resoudrePeriode(jeu, jeu.temps ? filtresBruts.periode : undefined, ctx)
  const filtres = validerFiltres(jeu, filtresBruts)

  // Instantane (stock) : des mois differents ne s'additionnent pas. Il faut UN mois, ou une
  // dimension au grain du mois qui separe chaque mois sur sa propre ligne.
  const instantane = Boolean(jeu.temps?.instantane) || mesures.some(m => m.instantane)
  if (instantane) {
    const cle = jeu.instantanePar
    const moisFiltre = cle && typeof filtres[cle] === 'string' && MOTIF_PERIODE.test(filtres[cle])
    if (cle && !moisFiltre && !dimensions.some(dimension => dimension.cle === cle)) {
      throw new ErreurDonnees('Filtrez le jeu sur un seul mois via filtres.autres.' + cle + ' ou ajoutez la dimension ' + cle + '.', 'periode_invalide')
    }
    const unSeulMois = periode !== null && periode.debut === periode.fin
    if (!cle && !unSeulMois && !dimensions.some(estAuGrainDuMois)) {
      throw new ErreurDonnees(
        `Le jeu ${jeu.cle} est un instantané mensuel : les valeurs de mois différents ne s'additionnent pas. ` +
          `Demandez un seul mois (filtres.periode {debut: 'YYYY-MM', fin: même mois} ou {dernierMoisClos: true}) ` +
          `ou ajoutez la dimension periode (granularite 'mois').`,
        'periode_invalide'
      )
    }
  }

  const selection = [...dimensions.map(d => d.cle), ...mesures.map(m => m.cle)]
  const tri: RequeteValidee['tri'] = []
  for (const element of brute.tri ?? []) {
    if (!selection.includes(element.cle)) {
      throw new ErreurDonnees(
        `Tri impossible sur "${element.cle}" : la clé doit être une dimension ou une mesure demandée (${listePossibles(selection)}).`,
        'requete_invalide'
      )
    }
    if (!tri.some(t => t.cle === element.cle)) tri.push({ cle: element.cle, sens: element.sens })
  }

  const normalisee: RequeteValidee = {
    jeu: jeu.cle,
    mesures: clesMesures,
    dimensions: clesDimensions,
    periode,
    filtres,
    ...(granularite ? { granularite } : {}),
    tri,
    ...(brute.limite ? { limite: brute.limite } : {}),
    periodeParDefaut: parDefaut,
  }
  return { entree, normalisee }
}

// ---------------------------------------------------------------------------
// Coherence du registre (pour les tests du catalogue)
// ---------------------------------------------------------------------------

const MOTIF_CLE = /^[a-z][a-z0-9_]*$/
const MOTIF_CLE_FILTRE = /^[a-z][a-zA-Z0-9_]*$/
const MOTIF_VUE = /^mv_[a-z0-9_]+$/

/**
 * Anomalies de structure d'un registre (liste vide = registre sain) : cles invalides ou en
 * double, collisions entre dimensions, mesures et dimensions temporelles, vue mal nommee,
 * libelles incomplets, filtre 'ids' sans entite. Sert aux tests du catalogue complet.
 */
export function verifierRegistre(registre: Registre): string[] {
  const anomalies: string[] = []
  const jeux = new Set<string>()
  const vues = new Set<string>()
  for (const { jeu, vue } of registre) {
    const ou = `jeu ${jeu.cle}`
    if (jeux.has(jeu.cle)) anomalies.push(`${ou} : cle de jeu en double`)
    jeux.add(jeu.cle)
    if (!MOTIF_VUE.test(vue.nom)) anomalies.push(`${ou} : vue "${vue.nom}" mal nommee (mv_...)`)
    if (vues.has(vue.nom)) anomalies.push(`${ou} : vue "${vue.nom}" en double`)
    vues.add(vue.nom)
    if (vue.nom !== jeu.vue)
      anomalies.push(`${ou} : jeu.vue "${jeu.vue}" differe de vue.nom "${vue.nom}"`)
    if (vue.jeu !== jeu.cle) anomalies.push(`${ou} : vue.jeu "${vue.jeu}" differe`)
    if (!libelleComplet(jeu.libelle)) anomalies.push(`${ou} : libelle incomplet`)

    const colonnes = new Set<string>()
    for (const element of [...jeu.dimensions, ...jeu.mesures]) {
      if (!MOTIF_CLE.test(element.cle)) anomalies.push(`${ou} : cle "${element.cle}" invalide`)
      if (colonnes.has(element.cle)) anomalies.push(`${ou} : cle "${element.cle}" en double`)
      colonnes.add(element.cle)
      if (!libelleComplet(element.libelle))
        anomalies.push(`${ou} : libelle de "${element.cle}" incomplet`)
      if (/;|--|\/\*/.test(typeof element.expression === 'string' ? element.expression : element.expression.text))
        anomalies.push(`${ou} : expression de "${element.cle}" suspecte`)
    }
    if (jeu.temps) {
      for (const cle of CLES_TEMPORELLES) {
        if (jeu.mesures.some(m => m.cle === cle))
          anomalies.push(`${ou} : mesure "${cle}" masque une dimension temporelle`)
      }
      const calendrier = jeu.temps.calendrier
      if (calendrier) {
        if (!vue.colonnes.some(c => c.nom === calendrier.colonneDate && c.type === 'date')) {
          anomalies.push(`${ou} : colonne de calendrier ${calendrier.colonneDate} indisponible`)
        }
      } else {
        for (const nom of ['periode', 'annee', 'mois', 'exercice']) {
          if (!vue.colonnes.some(c => c.nom === nom)) anomalies.push(`${ou} : jeu date sans colonne ${nom}`)
        }
      }
    }
    const filtres = new Set<string>()
    for (const filtre of jeu.filtres) {
      if (!MOTIF_CLE_FILTRE.test(filtre.cle) || (filtre.cle === 'periode' && jeu.temps)) {
        anomalies.push(`${ou} : cle de filtre "${filtre.cle}" invalide`)
      }
      if (filtres.has(filtre.cle)) anomalies.push(`${ou} : filtre "${filtre.cle}" en double`)
      filtres.add(filtre.cle)
      if (filtre.type === 'ids' && !filtre.entite)
        anomalies.push(`${ou} : filtre "${filtre.cle}" sans entite`)
      if (!libelleComplet(filtre.libelle))
        anomalies.push(`${ou} : libelle du filtre "${filtre.cle}" incomplet`)
    }
    for (const regle of jeu.regles) {
      if (!libelleComplet(regle)) anomalies.push(`${ou} : regle incomplete (${regle.fr})`)
    }
  }
  return anomalies
}
