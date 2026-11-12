/** Extraction d'un fichier texte : decodage, retours a la ligne normalises, plafond de caracteres. */

import { PLAFONDS, type ContenuTexte } from '../types'
import { decoderTexte } from './decodage'

export function extraireTexte(octets: Uint8Array): ContenuTexte {
  const complet = decoderTexte(octets).replace(/\r\n?/g, '\n')
  const tronque = complet.length > PLAFONDS.caracteresTexteMax
  const texte = tronque ? complet.slice(0, PLAFONDS.caracteresTexteMax) : complet
  return { type: 'texte', format: 'texte', pages: [{ numero: 1, texte }], nbPages: 1, tronque }
}
