/**
 * Limite de débit, par utilisateur, des calculs qui peuvent occuper la base jusqu'à 15 s :
 * l'outil `requete_sql` et le rejeu d'un jeu en base (lecture d'un jeu dont le cache n'est pas servi, recalcul, export).
 *
 * Fenêtre glissante, EN MÉMOIRE du processus : le serveur de production est un seul processus
 * Node (IIS → node, SRV-DC). Avec plusieurs processus, chacun aurait sa propre limite : il
 * faudrait alors un compteur partagé (base ou Redis). Un redémarrage remet les compteurs à zéro,
 * ce qui est sans gravité pour une protection de charge.
 *
 * Mémoire bornée : au plus `max` horodatages par utilisateur, et les utilisateurs inactifs sont
 * purgés quand la table grossit.
 */

/** Code d'erreur stable, rendu au modèle (ErreurOutil) et à l'interface (API). */
export const CODE_LIMITE_DEBIT_DONNEES = 'limite_debit_donnees' as const

export interface ReglageLimite {
  /** Appels permis par fenêtre. */
  max: number
  /** Durée de la fenêtre glissante, en millisecondes. */
  fenetreMs: number
}

/** 50 appels par tranche glissante de 10 minutes et par utilisateur (décision métier du raccord 3). */
export const LIMITE_REQUETES_SQL: ReglageLimite = { max: 50, fenetreMs: 10 * 60 * 1000 }
export const LIMITE_RECALCULS_JEU: ReglageLimite = { max: 50, fenetreMs: 10 * 60 * 1000 }

export type ResultatLimite = { accepte: true } | { accepte: false; reessayerDansMs: number }

/** Au-delà de ce nombre d'utilisateurs suivis, les entrées expirées sont purgées. */
const SEUIL_PURGE = 1_000

export class LimiteurDebit {
  private readonly appels = new Map<string, number[]>()

  constructor(
    readonly reglage: ReglageLimite,
    private readonly horloge: () => number = () => Date.now()
  ) {}

  /** Compte un appel pour `cle` s'il reste du crédit ; sinon dit dans combien de temps réessayer. */
  consommer(cle: string): ResultatLimite {
    const maintenant = this.horloge()
    const debut = maintenant - this.reglage.fenetreMs
    const recents = (this.appels.get(cle) ?? []).filter(t => t > debut)
    if (recents.length >= this.reglage.max) {
      this.appels.set(cle, recents)
      const plusAncien = recents[0] ?? maintenant
      const reste = plusAncien + this.reglage.fenetreMs - maintenant
      return { accepte: false, reessayerDansMs: Math.max(1, reste) }
    }
    recents.push(maintenant)
    this.appels.set(cle, recents)
    if (this.appels.size > SEUIL_PURGE) this.purger(debut)
    return { accepte: true }
  }

  /** Rend le dernier appel compté (calcul refusé avant d'avoir touché la base). */
  rembourser(cle: string): void {
    const liste = this.appels.get(cle)
    if (liste && liste.length > 0) liste.pop()
  }

  /** Vide les compteurs (tests). */
  reinitialiser(): void {
    this.appels.clear()
  }

  private purger(debut: number): void {
    for (const [cle, liste] of this.appels) {
      if (!liste.some(t => t > debut)) this.appels.delete(cle)
    }
  }
}

/** Minutes entières (au moins 1) avant de réessayer, pour les messages. */
export function minutesAvantReessai(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000))
}

// Une seule instance par processus, gardée sur globalThis pour survivre au rechargement à chaud
// du développement (même motif que le client Prisma).
export interface LimiteursDonnees {
  requeteSql: LimiteurDebit
  recalculJeu: LimiteurDebit
}
const global = globalThis as unknown as { __medicAssistLimitesDebitDonnees?: LimiteursDonnees }

export function limiteurs(): LimiteursDonnees {
  global.__medicAssistLimitesDebitDonnees ??= {
    requeteSql: new LimiteurDebit(LIMITE_REQUETES_SQL),
    recalculJeu: new LimiteurDebit(LIMITE_RECALCULS_JEU),
  }
  return global.__medicAssistLimitesDebitDonnees
}

/** Remet à zéro les deux limiteurs (tests : isole les cas entre eux). */
export function reinitialiserLimiteurs(): void {
  delete global.__medicAssistLimitesDebitDonnees
}
