/**
 * Transcription serveur d'un enregistrement audio (repli quand le navigateur
 * n'a pas de reconnaissance vocale integree, ex. Firefox).
 * POST /api/medic-assist/transcription (FormData { audio, langue, dureeSecondes })
 * -> TranscriptionDto { texte, langue?, dureeSecondes? }
 * Erreurs : `{ error: <code>, message }` (ex. 503 `transcriptionIndisponible`) ; voir erreurs-api.ts.
 */

import { appelApi, deballer } from './api'
import type { TranscriptionDto } from '@/lib/medic-assist/contrats'

/** Extension du fichier envoye, d'apres le type MIME enregistre (defaut : .webm). */
export function extensionAudio(type: string): string {
  const base = type.split(';')[0]?.trim().toLowerCase() ?? ''
  if (base === 'audio/mp4' || base === 'audio/x-m4a' || base === 'audio/m4a') return 'm4a'
  if (base === 'audio/ogg') return 'ogg'
  return 'webm'
}

/**
 * `dureeSecondes` : duree reelle de l'enregistrement, mesuree par chrono et
 * arrondie a 0,1 s (le serveur s'en sert pour la facturation/les usages).
 */
export async function transcribeAudio(
  blob: Blob,
  locale: string,
  dureeSecondes: number,
): Promise<string> {
  const corps = new FormData()
  corps.append('audio', blob, `dictee.${extensionAudio(blob.type)}`)
  corps.append('langue', locale)
  corps.append('dureeSecondes', String(Math.round(dureeSecondes * 10) / 10))
  const reponse = await appelApi<unknown>('/api/medic-assist/transcription', {
    method: 'POST',
    corps,
  })
  const donnees = deballer<Partial<TranscriptionDto> | undefined>(reponse)
  return typeof donnees?.texte === 'string' ? donnees.texte : ''
}
