/**
 * Types du catalogue semantique et des vues logiques `mv_*` (lot 2).
 *
 * Une ENTREE de catalogue = un jeu (`DefinitionJeu`, vu par le moteur semantique)
 * + sa vue logique (`DefinitionVue`, vue par le SQL controle). Les deux partagent
 * les memes colonnes : une dimension ou une mesure n'est qu'une expression SQL
 * sur les colonnes de la vue. Il n'existe donc QU'UNE definition du perimetre, des
 * regles d'activite et du CA par jeu, et le moteur semantique et `requete_sql`
 * donnent les memes chiffres.
 *
 * REGLE DE SECURITE : les expressions SQL de ce fichier sont ecrites en dur dans le
 * code. Le moteur ne les choisit que par CLE (dimension, mesure, filtre) ; aucune
 * chaine venue de l'IA ou du client n'entre dans le SQL, seules des valeurs
 * parametrees (Prisma.sql) y entrent.
 */

import type { Prisma } from '@prisma/client'

import type { Locale } from '@/i18n/config'
import type { CleJeu, ContexteExecution, TypeColonne } from '@/lib/medic-assist/contrats'
import type { FiltresSemantiques } from '@/lib/medic-assist/donnees/requete-interne'

/** Texte visible, dans les six langues de l'interface. */
export type Libelle = Record<Locale, string>

export interface LienEcranDef {
  /** Chemin interne avec ses parametres d'URL REELLEMENT lus par l'ecran. */
  href: string
  libelle: Libelle
}

export type AgregatMesure =
  | 'somme'
  | 'moyenne'
  | 'min'
  | 'max'
  | 'nombre'
  | 'nombre_distinct'
  | 'rapport'

export interface DefinitionDimension {
  /** Cle stable, snake_case francais (ex. 'pays', 'produit', 'periode'). */
  cle: string
  libelle: Libelle
  /** Definition metier en francais, destinee au modele (pas a l'affichage). */
  definition: string
  type: TypeColonne
  /** Expression SQL sur les colonnes de la vue (ex. 'pays', 'exercice'). Sert au SELECT et au GROUP BY. */
  expression: string
  /** Valeurs possibles quand la dimension est une enumeration (statuts...). */
  valeursPossibles?: string[]
}

export interface DefinitionMesure {
  /** Cle stable, snake_case francais (ex. 'ca_eur', 'quantite_vendue'). */
  cle: string
  libelle: Libelle
  /** Definition metier en francais, destinee au modele. */
  definition: string
  type: Exclude<TypeColonne, 'texte' | 'date' | 'periode'>
  /** Unite affichee : 'EUR', 'unites', '%', 'jours'... */
  unite?: string
  devise?: string
  colonnesRequises?: string[]
  agregat: AgregatMesure
  /**
   * Expression d'AGREGAT SQL sur les colonnes de la vue (ex. 'SUM(ca_eur)'). Elle rend
   * un nombre ; le moteur la convertit en float8. Un taux est un RAPPORT de sommes
   * (jamais la moyenne de taux de lignes). Le moteur calcule la ligne de totaux en
   * relancant la meme expression sans GROUP BY : un rapport reste donc exact.
   */
  expression: string | Prisma.Sql
  /** Regles propres a la mesure, ajoutees a la provenance quand elle est demandee. */
  regles?: Libelle[]
  /** Vrai si les valeurs de mois differents ne s'additionnent pas (stock). */
  instantane?: boolean
}

export type TypeFiltre = 'ids' | 'texte' | 'liste' | 'nombre' | 'booleen' | 'date'

export type EntiteFiltre =
  | 'pays'
  | 'produit'
  | 'grossiste'
  | 'agence'
  | 'molecule'
  | 'laboratoire'
  | 'classe_therapeutique'

export interface DefinitionFiltre {
  /** Cle dans `RequeteSemantique.filtres` (ex. 'paysIds', 'statuts', 'expireDansJours'). */
  cle: string
  libelle: Libelle
  /** Definition en francais, destinee au modele. */
  definition: string
  type: TypeFiltre
  /** Pour 'ids' : l'entite designee, pour retrouver les NOMS dans la provenance. */
  entite?: EntiteFiltre
  /** Pour 'liste' : valeurs acceptees. */
  valeursPossibles?: string[]
  /**
   * Condition SQL sur les colonnes de la vue. `valeur` a deja ete valide selon `type`
   * (ids : string[] non vide ; liste : string[] ; nombre : number ; booleen : boolean).
   */
  condition: (valeur: unknown, ctx: ContexteExecution) => Prisma.Sql
}

/**
 * Temps d'un jeu. Un jeu a `temps` expose OBLIGATOIREMENT dans sa vue les colonnes
 * `periode` (texte 'YYYY-MM'), `annee` (int), `mois` (int, 1-12) et `exercice` (int,
 * annee de depart avril -> mars). Un jeu sans `temps` refuse tout filtre de periode.
 */
export interface TempsJeu {
  /**
   * Periode appliquee quand la requete n'en donne aucune :
   * 'dernier_mois_clos' (ventes, stocks...), 'aucune' (budget : toutes les periodes).
   */
  defaut: 'dernier_mois_clos' | 'aucune'
  /**
   * Instantane : les valeurs de mois differents ne s'additionnent pas (stock). Le moteur
   * exige alors UN seul mois, ou la dimension `periode`, et refuse sinon avec un message clair.
   */
  instantane?: boolean
}

export interface DefinitionJeu {
  cle: CleJeu
  libelle: Libelle
  /** Description en francais, destinee au modele (une a deux phrases). */
  description: string
  /** Grain en francais : « une ligne = un produit vendu par un grossiste, une agence et un mois ». */
  granularite: string
  cles?: string[]
  calendrier?: string
  responsable?: string
  versionMetier?: number
  /** Nom de la vue logique, ex. 'mv_ventes'. */
  vue: string
  dimensions: DefinitionDimension[]
  mesures: DefinitionMesure[]
  /** Filtres propres au jeu EN PLUS de la periode (geree par le moteur via `temps`). */
  filtres: DefinitionFiltre[]
  temps?: TempsJeu
  /** Dimension au grain du mois pour les mesures de type instantané. */
  instantanePar?: string
  /** Regles de calcul du jeu, affichees dans la provenance (« CA = quantite x PGHT de la ligne »...). */
  regles: Libelle[]
  /** Reserve au siege (ventes concurrents...). Medic Assist etant reserve au siege, informatif. */
  siegeSeulement?: boolean
  /** Questions types en francais, pour le resume compact du prompt (1 a 3, courtes). */
  exemples?: string[]
  /**
   * Ecran officiel equivalent, avec les parametres d'URL que l'ecran LIT vraiment
   * (verifier dans le code de la page). Absent : pas de lien. Aucun parametre invente.
   */
  lienEcran?: (requete: RequeteNormalisee, ctx: ContexteExecution) => LienEcranDef | undefined
}

export interface ColonneVue {
  nom: string
  type: TypeColonne
  synonymes?: string[]
  /** Description en francais, montree au modele dans le catalogue SQL. */
  description: string
}

export interface DefinitionVue {
  /** Nom de la vue logique, prefixe `mv_`. */
  nom: string
  jeu: CleJeu
  /** Description en francais, montree au modele. */
  description: string
  /** Colonnes METIER lisibles, snake_case francais. JAMAIS de colonne sensible (mot de passe, mfa, audit, parametres, jeton). */
  colonnes: ColonneVue[]
  /**
   * Corps de la vue : un `SELECT ... FROM ... WHERE ...` sans `WITH` ni `;`, deja filtre par le
   * perimetre du lecteur (`ctx.scope`) et par les regles d'activite (inactifs exclus), qui
   * reutilise les fragments officiels (ventesActivesSql, scopeSortiesLocalesSql, porteeVisas...).
   * Toute valeur variable passe par Prisma.sql (parametres), jamais par concatenation.
   * Il rend EXACTEMENT les colonnes de `colonnes`, dans cet ordre.
   */
  signature?: string
  /** Jeux directement lus par une combinaison, pour appliquer leurs droits avant publication. */
  dependances?: string[]
  snapshots?: { jeu: string; empreinte: string; source: string }[]
  cte: (ctx: ContexteExecution) => Prisma.Sql
}

export interface EntreeCatalogue {
  jeu: DefinitionJeu
  vue: DefinitionVue
}

/** Registre injecte dans le moteur (permet de le tester avec un faux catalogue). */
export type Registre = ReadonlyArray<EntreeCatalogue>

/** Requete semantique validee et resolue par le moteur : ce que voit `lienEcran`. */
export interface RequeteNormalisee {
  jeu: CleJeu
  mesures: string[]
  dimensions: string[]
  /** Periode effective, bornes 'YYYY-MM' incluses ; null pour un jeu sans temps ou sans periode par defaut. */
  periode: {
    debut: string
    fin: string
    origine: 'explicite' | 'exercice' | 'dernier_mois_clos'
    exercice?: number
  } | null
  /** Filtres valides, sans `periode`. */
  filtres: FiltresSemantiques
  granularite?: 'mois' | 'trimestre' | 'exercice' | 'annee'
}
