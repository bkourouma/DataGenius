/**
 * Petit cache mémoire des REJEUX d'un jeu de données (lecteur qui n'est pas le propriétaire,
 * périmètre changé, export) : sans lui, chaque page d'un défilement ou d'un export rejouerait la
 * requête en base, et consommerait un crédit de la limite de débit à chaque fois.
 *
 * Clé : utilisateur + jeu + empreinte du périmètre + plafond de lignes + langue (les libellés de provenance en dépendent). Le cache ne mélange donc
 * jamais deux lecteurs ni deux périmètres. Durée de vie courte (5 min), nombre d'entrées et
 * volume de lignes bornés ; sur globalThis comme `limite-debit.ts` (une instance par processus).
 */

import type { ContenuJeu } from './enregistrer'

/** Durée de vie d'une entrée. */
export const TTL_CACHE_REJEU_MS = 5 * 60 * 1000
/** Nombre maximal d'entrées. */
export const ENTREES_MAX_CACHE_REJEU = 16
/** Volume maximal de lignes gardées, toutes entrées confondues. */
export const LIGNES_MAX_CACHE_REJEU = 150_000

interface Entree {
  contenu: ContenuJeu
  expireA: number
}

export interface CleCacheRejeu {
  userId: string
  jeuId: string
  empreinte: string
  limiteLignes: number
  locale: string
}

function cle(c: CleCacheRejeu): string {
  return JSON.stringify([c.userId, c.jeuId, c.empreinte, c.limiteLignes, c.locale])
}

export class CacheRejeu {
  // Map conserve l'ordre d'insertion : la première entrée est la plus ancienne.
  private readonly entrees = new Map<string, Entree>()

  constructor(private readonly horloge: () => number = () => Date.now()) {}

  lire(c: CleCacheRejeu): ContenuJeu | null {
    const k = cle(c)
    const entree = this.entrees.get(k)
    if (!entree) return null
    if (entree.expireA <= this.horloge()) {
      this.entrees.delete(k)
      return null
    }
    return entree.contenu
  }

  ecrire(c: CleCacheRejeu, contenu: ContenuJeu): void {
    if (contenu.lignes.length > LIGNES_MAX_CACHE_REJEU) return
    const k = cle(c)
    this.entrees.delete(k)
    this.purgerExpirees()
    this.entrees.set(k, { contenu, expireA: this.horloge() + TTL_CACHE_REJEU_MS })
    while (this.entrees.size > ENTREES_MAX_CACHE_REJEU || this.totalLignes() > LIGNES_MAX_CACHE_REJEU) {
      const plusAncienne = this.entrees.keys().next().value
      if (plusAncienne === undefined) break
      this.entrees.delete(plusAncienne)
    }
  }

  get taille(): number {
    return this.entrees.size
  }

  reinitialiser(): void {
    this.entrees.clear()
  }

  private purgerExpirees(): void {
    const maintenant = this.horloge()
    for (const [k, entree] of this.entrees) {
      if (entree.expireA <= maintenant) this.entrees.delete(k)
    }
  }

  private totalLignes(): number {
    let total = 0
    for (const entree of this.entrees.values()) total += entree.contenu.lignes.length
    return total
  }
}

const global = globalThis as unknown as { __medicAssistCacheRejeuJeux?: CacheRejeu }

/** Le cache du processus. */
export function cacheRejeu(): CacheRejeu {
  global.__medicAssistCacheRejeuJeux ??= new CacheRejeu()
  return global.__medicAssistCacheRejeuJeux
}
