/**
 * Sémaphore d'exports, global au processus et NON bloquant.
 *
 * Un export complet charge les jeux de données en mémoire (jusqu'à 100 000 lignes) puis
 * construit le fichier : on borne donc le nombre d'exports simultanés. Quand toutes les places
 * sont prises, `essayerPrendre` rend `null` tout de suite (la route répond 503 + Retry-After),
 * il n'y a jamais de file d'attente.
 *
 * Ne concerne que la route HTTP ; les rapports programmés n'y passent pas.
 */

/** Nombre d'exports simultanés au plus, par processus. */
export const EXPORTS_SIMULTANES_MAX = 2;

/** Délai conseillé au client avant de réessayer, en secondes (en-tête `Retry-After`). */
export const REESSAI_EXPORTS_OCCUPES_SECONDES = 10;

/**
 * Durée maximale d'un flux d'export, en ms. Au-delà, le flux est annulé avec erreur et la place
 * rendue : un client bloqué sans déconnexion ne peut pas occuper les places indéfiniment.
 */
export const DELAI_MAX_FLUX_EXPORT_MS = 5 * 60 * 1000;

export interface SemaphoreNonBloquant {
  /**
   * Prend une place. Rend la fonction de libération (idempotente : un second appel est sans
   * effet), ou `null` si toutes les places sont prises.
   */
  essayerPrendre(): (() => void) | null;
  /** Places prises en ce moment. */
  readonly utilisees: number;
  /** Nombre de places ; modifiable (tests). Les places déjà prises ne sont pas retirées. */
  capacite: number;
}

export function creerSemaphore(capacite: number): SemaphoreNonBloquant {
  let utilisees = 0;
  const semaphore: SemaphoreNonBloquant = {
    capacite,
    get utilisees() {
      return utilisees;
    },
    essayerPrendre() {
      if (utilisees >= semaphore.capacite) return null;
      utilisees += 1;
      let libere = false;
      return () => {
        if (libere) return;
        libere = true;
        utilisees -= 1;
      };
    },
  };
  return semaphore;
}

/** Le sémaphore de la route d'export. */
export const semaphoreExports: SemaphoreNonBloquant = creerSemaphore(EXPORTS_SIMULTANES_MAX);
