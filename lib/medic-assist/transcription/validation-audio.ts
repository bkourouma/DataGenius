/**
 * Validation d'un enregistrement envoye pour transcription.
 *
 * Le type annonce par le client (ex. `audio/webm;codecs=opus`) n'est pas fiable : on exige
 * (extension OU type annonce dans la liste blanche) ET une signature d'octets reconnue.
 * Le type retenu pour le fournisseur est celui de la SIGNATURE.
 */

import { LIMITES } from '../admin/imports-lot0-lot1'

export type TypeAudio = 'webm' | 'ogg' | 'mp4' | 'wav'

export const TYPE_MIME_PAR_TYPE_AUDIO: Record<TypeAudio, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  mp4: 'audio/mp4',
  wav: 'audio/wav',
}

const EXTENSIONS: Record<string, TypeAudio> = {
  webm: 'webm',
  weba: 'webm',
  ogg: 'ogg',
  oga: 'ogg',
  opus: 'ogg',
  mp4: 'mp4',
  m4a: 'mp4',
  wav: 'wav',
  wave: 'wav',
}

const TYPES_ANNONCES: Record<string, TypeAudio> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'application/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'video/mp4': 'mp4',
  'audio/x-m4a': 'mp4',
  'audio/m4a': 'mp4',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/vnd.wave': 'wav',
}

export type ErreurAudio = {
  ok: false
  status: 400 | 413
  code: 'audioVide' | 'audioTropGros' | 'audioFormatRefuse'
  message: string
}
export type AudioValide = { ok: true; type: TypeAudio; typeMime: string }

function egal(octets: Uint8Array, decalage: number, attendu: number[]): boolean {
  if (octets.length < decalage + attendu.length) return false
  return attendu.every((valeur, i) => octets[decalage + i] === valeur)
}

/** Reconnait le conteneur par ses premiers octets, ou null. */
export function detecterTypeAudio(octets: Uint8Array): TypeAudio | null {
  if (egal(octets, 0, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm' // EBML
  if (egal(octets, 0, [0x4f, 0x67, 0x67, 0x53])) return 'ogg' // "OggS"
  if (egal(octets, 4, [0x66, 0x74, 0x79, 0x70])) return 'mp4' // "ftyp" a l'offset 4
  if (
    egal(octets, 0, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    egal(octets, 8, [0x57, 0x41, 0x56, 0x45]) // "WAVE"
  ) {
    return 'wav'
  }
  return null
}

function typeParExtension(nom: string): TypeAudio | null {
  const point = nom.lastIndexOf('.')
  if (point < 0) return null
  return EXTENSIONS[nom.slice(point + 1).toLowerCase()] ?? null
}

function typeParTypeAnnonce(typeAnnonce: string): TypeAudio | null {
  const base = typeAnnonce.split(';')[0]?.trim().toLowerCase() ?? ''
  return TYPES_ANNONCES[base] ?? null
}

/** Controle de taille seul, utilisable avant de lire le fichier en memoire. */
export function validerTailleAudio(taille: number): ErreurAudio | null {
  if (taille <= 0) {
    return { ok: false, status: 400, code: 'audioVide', message: 'Empty recording.' }
  }
  if (taille > LIMITES.tailleMaxAudioOctets) {
    return {
      ok: false,
      status: 413,
      code: 'audioTropGros',
      message: 'Recording too large (10 MB maximum).',
    }
  }
  return null
}

export function validerAudio(entree: {
  octets: Uint8Array
  nom: string
  typeAnnonce: string
}): AudioValide | ErreurAudio {
  const taille = validerTailleAudio(entree.octets.length)
  if (taille) return taille

  const annonceOk =
    typeParExtension(entree.nom) !== null || typeParTypeAnnonce(entree.typeAnnonce) !== null
  const signature = detecterTypeAudio(entree.octets)
  if (!annonceOk || !signature) {
    return {
      ok: false,
      status: 400,
      code: 'audioFormatRefuse',
      message: 'Unsupported audio format (webm, ogg, mp4 or wav).',
    }
  }
  return { ok: true, type: signature, typeMime: TYPE_MIME_PAR_TYPE_AUDIO[signature] }
}
