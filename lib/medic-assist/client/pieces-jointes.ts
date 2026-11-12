/**
 * Pieces jointes de la zone de saisie : validation cote client (confort, le
 * serveur revalide) et televersement.
 * POST /api/medic-assist/pieces-jointes (FormData, champ `fichier`) -> PieceJointeDto
(id, nom, extension, tailleOctets, typeMime...). On accepte aussi la forme courte
{ id, nom, taille } de la decision du superviseur.
 */

import { appelApi, deballer } from './api'
import type { PieceJointe } from './types'
import { LIMITES } from '@/lib/medic-assist/contrats/constantes'

export const EXTENSIONS_AUTORISEES = LIMITES.extensionsPiecesJointes
export const TAILLE_MAX_PIECE = LIMITES.tailleMaxPieceJointeOctets
export const NB_MAX_PIECES = LIMITES.piecesJointesMaxParMessage
/** Taille limite en Mo (pour l'affichage). */
export const TAILLE_MAX_PIECE_MO = TAILLE_MAX_PIECE / (1024 * 1024)
/** Valeur de l'attribut `accept` du champ fichier. */
export const ACCEPT_PIECES = EXTENSIONS_AUTORISEES.map((e) => `.${e}`).join(',')

export type RaisonRefus = 'extension' | 'taille' | 'vide'

export function validerFichier(fichier: File): { valide: true } | { valide: false; raison: RaisonRefus } {
  const point = fichier.name.lastIndexOf('.')
  const extension = point >= 0 ? fichier.name.slice(point + 1).toLowerCase() : ''
  if (!(EXTENSIONS_AUTORISEES as readonly string[]).includes(extension)) {
    return { valide: false, raison: 'extension' }
  }
  if (fichier.size === 0) return { valide: false, raison: 'vide' }
  if (fichier.size > TAILLE_MAX_PIECE) return { valide: false, raison: 'taille' }
  return { valide: true }
}

export async function televerserPieceJointe(fichier: File): Promise<PieceJointe> {
  const corps = new FormData()
  corps.append('fichier', fichier)
  const reponse = await appelApi<unknown>('/api/medic-assist/pieces-jointes', {
    method: 'POST',
    corps,
  })
  const donnees = deballer<{ id?: unknown; nom?: unknown; taille?: unknown; tailleOctets?: unknown } | undefined>(reponse)
  if (!donnees || typeof donnees.id !== 'string' || !donnees.id) {
    throw new Error('Reponse de televersement invalide')
  }
  return {
    id: donnees.id,
    nom: typeof donnees.nom === 'string' && donnees.nom ? donnees.nom : fichier.name,
    taille:
      typeof donnees.tailleOctets === 'number'
        ? donnees.tailleOctets
        : typeof donnees.taille === 'number'
          ? donnees.taille
          : fichier.size,
  }
}
