/**
 * Ports du lot 4 vers les autres lots : lecture d'un artefact et de ses jeux de données.
 *
 * Les exports (`construireExport`) et les routes ne parlent qu'à ces interfaces. En phase B,
 * `dependances.ts` les branche sur `stockage-impl.ts` (artefact) et sur `lireJeu` /
 * `lignesCompletesPourExport` du lot 2 (jeux). Dans les tests, on injecte des doublures.
 *
 * Règle de sécurité : les deux fonctions vérifient l'accès (propriétaire, partage, artefact
 * enregistré ou épinglé du lecteur) DANS la même requête que la lecture, et recalculent les
 * données dans le périmètre de `contexte.scope`. Elles renvoient null si l'accès est refusé
 * ou si l'élément n'existe pas (même réponse : on ne révèle pas l'existence).
 */

import type {
  ArtefactSpec,
  ColonneJeu,
  ContexteExecution,
  Provenance,
  TypeArtefact,
} from '@/lib/medic-assist/contrats';

import type { DonneesJeuReponse } from './reponse';

/** Propriétaire de l'artefact qui référence un jeu (accès du lot 2 « via un artefact »). */
export interface ViaArtefact {
  proprietaireId: string;
}

/** Une version d'artefact, telle que stockée. */
export interface ArtefactEnregistre {
  id: string;
  racineId: string;
  version: number;
  type: TypeArtefact;
  titre: string;
  sousTitre?: string;
  spec: ArtefactSpec;
  conversationId: string | null;
  /** Propriétaire de la conversation : lui seul édite. */
  userId: string;
  creeLe: Date;
}

/** Jeu de données complet (jusqu'à LIMITES.lignesMaxExport lignes) recalculé pour le lecteur. */
export interface JeuComplet {
  jeuDeDonneesId: string;
  colonnes: ColonneJeu[];
  lignes: Record<string, unknown>[];
  nbLignes: number;
  tronque: boolean;
  totaux?: Record<string, number>;
  provenance: Provenance;
}

export interface DependancesArtefacts {
  /** Dernière version si `version` est absent. Null : introuvable ou accès refusé. */
  chargerArtefact(
    artefactId: string,
    contexte: ContexteExecution,
    version?: number
  ): Promise<ArtefactEnregistre | null>;
  /**
   * Données COMPLÈTES pour un export (lignesCompletesPourExport du lot 2). `viaArtefact` :
   * propriétaire de l'artefact (déjà lu avec contrôle d'accès) qui référence ce jeu ; à passer
   * seulement quand le lecteur n'est pas ce propriétaire. Jamais issu d'un client ni du modèle.
   */
  chargerJeuComplet(
    jeuId: string,
    contexte: ContexteExecution,
    viaArtefact?: ViaArtefact
  ): Promise<JeuComplet | null>;
  /**
   * Lignes d'un jeu pour l'AFFICHAGE (GET artefact), au plus LIMITES.lignesMaxStockees, lues
   * page par page via `lireJeu` du lot 2. `recalculer` : rejoue la spécification dans le
   * périmètre du lecteur (lecteur non propriétaire). Null : jeu inaccessible. Membre facultatif
   * pour ne pas casser les doublures de l'orchestrateur d'export.
   */
  chargerLignesPourAffichage?(
    jeuId: string,
    contexte: ContexteExecution,
    options: { recalculer: boolean; viaArtefact?: ViaArtefact }
  ): Promise<DonneesJeuReponse | null>;
}

export type CodeErreurExport =
  | 'introuvable'
  | 'format_non_supporte'
  | 'jeu_indisponible'
  | 'trop_de_lignes'
  | 'limite_debit'
  | 'echec';

/** Erreur d'export : la route la traduit en code HTTP, le lot 5 en message d'échec. */
export class ErreurExport extends Error {
  constructor(
    public readonly code: CodeErreurExport,
    message?: string,
    /** Limite de débit seulement : délai avant de pouvoir réessayer, en millisecondes. */
    public readonly reessayerDansMs?: number
  ) {
    super(message ?? code);
    this.name = 'ErreurExport';
  }
}
