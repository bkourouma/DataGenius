/**
 * Revue du mois : contrat entre le calcul (serveur) et l'ecran.
 *
 * La revue lit un mois clos et le raconte : son resultat, le cumul de l'exercice,
 * la tendance de fond, la prevision a fin mars, d'ou vient l'ecart au budget, ce
 * qui a bouge, ce qu'il faut preparer pour le mois suivant et le potentiel non
 * capte. Tout est calcule deux fois, en unites et en euros, pour que l'ecran
 * bascule de l'un a l'autre sans nouvel appel.
 */

export type Mesure = 'unites' | 'ca';

/**
 * Etat d'un mois de l'exercice au moment de la lecture.
 * - clos : le jour limite de saisie est passe, le mois est comparable ;
 * - enSaisie : le mois est termine, les agences le declarent encore ;
 * - enCours : le mois n'est pas termine ;
 * - aVenir : le mois n'a pas commence.
 */
export type EtatMois = 'clos' | 'enSaisie' | 'enCours' | 'aVenir';

export interface MoisRuban {
  periode: string;
  etat: EtatMois;
  /** Date butoir de saisie, `YYYY-MM-DD`. */
  dateLimite: string;
  /** Realise / budget du mois, seulement pour un mois clos qui a un budget. */
  taux: Record<Mesure, number | null>;
}

/** Etat de la saisie d'un mois : agences attendues et agences qui ont declare. */
export interface Completude {
  periode: string;
  agencesAttendues: number;
  agencesSaisies: number;
  dateLimite: string;
  /** Pays dont au moins une agence n'a pas encore saisi, avec leur nombre. */
  manquantes: Array<{ paysId: string; paysNom: string; nombre: number }>;
}

export interface LigneEcart {
  id: string;
  nom: string;
  /** Cumul de l'exercice jusqu'au mois lu. */
  budget: number;
  realise: number;
  ecart: number;
  /** Le mois lu seul. */
  budgetMois: number;
  realiseMois: number;
}

export interface PointTrajectoire {
  periode: string;
  /** Cumul realise, jusqu'au mois lu inclus ; null ensuite. */
  realise: number | null;
  /** Cumul prevu, a partir du mois lu inclus ; null avant. */
  prevision: number | null;
  bas: number | null;
  haut: number | null;
  budget: number;
  /** Cumul du meme mois de l'exercice precedent. */
  precedent: number;
}

export interface Mouvement {
  paysId: string;
  paysNom: string;
  produitId: string;
  produitNom: string;
  valeur: number;
  valeurN1: number;
  ecart: number;
  /** Treize mois, du meme mois de l'an passe au mois lu. */
  serie: number[];
}

export type TypeAlerte = 'rupture' | 'decrochage' | 'commandes' | 'saisie';
export type GraviteAlerte = 'critique' | 'attention' | 'info';

export interface Alerte {
  type: TypeAlerte;
  gravite: GraviteAlerte;
  paysId?: string;
  paysNom?: string;
  produitId?: string;
  produitNom?: string;
  /** Rupture : mois de stock restants au rythme des trois derniers mois. */
  moisDeStock?: number;
  ventesMensuelles?: number;
  /** Rupture : jour du mois suivant ou le stock serait epuise. */
  jourEpuisement?: number;
  /** Decrochage : nombre de mois consecutifs sous le budget. */
  nombreMois?: number;
  tauxMoyen?: number;
  ecartCumule?: number;
  /** Commandes : grossistes sans commande, sur le nombre de grossistes vendeurs du pays. */
  grossistes?: number;
  grossistesPays?: number;
  /** Commandes : premier mois sans commande. */
  depuis?: string;
  /** Saisie : agences manquantes et date butoir. */
  agencesManquantes?: number;
  periode?: string;
  dateLimite?: string;
  /** Six derniers mois, pour la mini-courbe (realise et budget). */
  historique?: Array<{ periode: string; realise: number; budget: number }>;
  /** Poids de l'alerte dans la mesure de la vue, pour les classer. */
  impact: number;
}

export interface Opportunite {
  paysId: string;
  paysNom: string;
  produitId: string;
  produitNom: string;
  /** Gain annuel estime ; null quand aucune reference ne permet de l'estimer. */
  valeur: number | null;
  /** Parts de marche : part actuelle et part visee. */
  part?: number;
  partVisee?: number;
}

export interface Potentiel {
  rattrapage: { total: number; lignes: Opportunite[] };
  partsDeMarche: { total: number; lignes: Opportunite[]; gainPoints: number; disponible: boolean };
  lancements: {
    total: number;
    lignes: Opportunite[];
    ammEnCours: Array<{ paysNom: string; produitNom: string }>;
  };
}

export interface Vue {
  mois: { realise: number; budget: number; realiseN1: number };
  cumul: { realise: number; budget: number; realiseN1: number; budgetAnnuel: number };
  glissant: { realise: number; precedent: number };
  prevision: {
    total: number;
    bas: number;
    haut: number;
    /** Prevision faite a la fin du mois precedent ; null au premier mois de l'exercice. */
    precedente: number | null;
  };
  /** Douze derniers mois, du plus ancien au mois lu. */
  serieMensuelle: number[];
  /** Cumul glissant sur douze mois, pour chacun des douze derniers mois. */
  serieGlissante: number[];
  ecartsPays: LigneEcart[];
  /** Ecarts par produit, indexes par pays. */
  ecartsProduits: Record<string, LigneEcart[]>;
  trajectoire: PointTrajectoire[];
  mouvements: { hausses: Mouvement[]; baisses: Mouvement[] };
  alertes: Alerte[];
  potentiel: Potentiel;
}

export interface PaysPerimetre {
  id: string;
  nom: string;
  region: string;
}

export interface RevueMensuelle {
  /** Mois lu, `YYYY-MM`. */
  periode: string;
  exercice: number;
  /** Dernier mois clos a la date de lecture. */
  dernierClos: string;
  ruban: MoisRuban[];
  completude: Completude;
  /** Mois en cours de saisie, s'il y en a un dans l'exercice affiche. */
  saisieEnCours: Completude | null;
  perimetre: {
    pays: PaysPerimetre[];
    regions: string[];
    selection: { paysId: string | null; region: string | null };
  };
  /** Ce que la base renseigne vraiment : une alerte sans donnee serait un faux signal. */
  donnees: {
    budgets: boolean;
    stocks: boolean;
    commandes: boolean;
    ventesConcurrents: boolean;
  };
  vues: Record<Mesure, Vue>;
  genereLe: string;
}
