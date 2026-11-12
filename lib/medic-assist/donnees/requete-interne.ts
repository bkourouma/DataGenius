/**
 * Forme INTERNE d'une requete semantique, a plat : les filtres declares par le catalogue
 * (`filtres.autres` dans le contrat du lot 0) sont ranges au meme niveau que les filtres
 * fixes. Le moteur et le catalogue ne manipulent que cette forme ; `aplatirRequete` fait
 * la conversion a la frontiere (outils `interroger_donnees`, rejeu d'un jeu stocke).
 */

import type {
  CleJeu,
  Granularite,
  RequeteSemantique as RequeteContrat,
  Tri,
} from '@/lib/medic-assist/contrats'

import { ErreurDonnees } from './types'

export interface FiltresSemantiques {
  periode?:
    | { debut: string; fin: string } // 'YYYY-MM'
    | { exercice: number }
    | { dernierMoisClos: true }
  /** Autres filtres declares par le catalogue du jeu. */
  [autre: string]: unknown
}

export interface RequeteSemantique {
  jeu: CleJeu
  mesures: string[]
  dimensions?: string[]
  filtres?: FiltresSemantiques
  tri?: Tri[]
  limite?: number
  granularite?: Granularite
}

/**
 * Contrat (`filtres.autres`) -> forme a plat. Une cle de `autres` qui reprend une cle
 * fixe est refusee : elle contournerait la validation propre a cette cle.
 */
export function aplatirRequete(requete: RequeteContrat | RequeteSemantique): RequeteSemantique {
  const { filtres, ...reste } = requete as RequeteContrat
  if (!filtres) return reste as RequeteSemantique
  const { autres, ...fixes } = filtres as RequeteContrat['filtres'] & {
    autres?: Record<string, unknown>
  }
  const plats: FiltresSemantiques = { ...fixes }
  for (const [cle, valeur] of Object.entries(autres ?? {})) {
    if (Object.hasOwn(fixes, cle) || cle === 'autres') {
      throw new ErreurDonnees(
        `Le filtre "${cle}" est un filtre fixe : passe-le directement dans filtres, pas dans filtres.autres.`,
        'filtre_invalide'
      )
    }
    plats[cle] = valeur
  }
  return { ...reste, filtres: plats } as RequeteSemantique
}
