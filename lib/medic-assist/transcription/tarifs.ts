/**
 * Tarif de la dictee serveur, A LA MINUTE d'audio (et non au jeton).
 *
 * SOURCE : page de tarification officielle d'OpenAI, https://developers.openai.com/api/docs/pricing,
 * section « Transcription », colonne « Estimated cost », consultee le 02/11/2026 :
 *   - gpt-transcribe         : 0,0045 USD / minute (ajoute le 02/11/2026)
 *   - gpt-4o-mini-transcribe : 0,003 USD / minute (1,25 USD entree, 5,00 USD sortie par million de jetons)
 *   - gpt-4o-transcribe      : 0,006 USD / minute (2,50 USD / 10,00 USD par million de jetons)
 *   - whisper-1 (« Whisper ») : 0,006 USD / minute
 * Le SDK ne renvoie pas de jetons pour `transcribe()` : la duree de l'audio sert de base.
 *
 * MODELE INCONNU (autre identifiant OpenAI, modele Google de transcription) : cout 0, et
 * l'appel est tout de meme enregistre (requetes, duree). Ce choix est documente ici : un
 * tarif non confirme n'est jamais invente. Pour Google via generateText, le cout est estime
 * dans transcrire.ts avec le tarif au jeton du modele s'il existe, sinon 0.
 */

/** USD par minute d'audio, par identifiant de modele de transcription OpenAI. */
export const TARIF_TRANSCRIPTION_USD_PAR_MINUTE: Readonly<Record<string, number>> = {
  'gpt-transcribe': 0.0045,
  'gpt-4o-mini-transcribe': 0.003,
  'gpt-4o-transcribe': 0.006,
  'whisper-1': 0.006,
}

/** Duree plausible d'une dictee : un client ne peut pas fausser la comptabilite au-dela. */
export const DUREE_MAX_SECONDES = 3600

export function arrondirCout(valeur: number): number {
  return Math.round(valeur * 1_000_000) / 1_000_000
}

function borner(valeur: number): number {
  return Math.min(DUREE_MAX_SECONDES, Math.max(0, valeur))
}

/** Debit audio minimal retenu pour le plancher (octets par seconde, ~128 kbit/s). */
export const OCTETS_PAR_SECONDE_PLANCHER = 16_000

/**
 * Duree facturee : la plus grande de la duree annoncee par le client, de celle retournee par le
 * SDK et d'un plancher estime d'apres la taille du fichier (octets / 16 000 par seconde), donc
 * un client qui annonce 0 ne facture pas 0. Bornee a [0, 3600]. Valeur absente ou non finie
 * ignoree ; 0 sans aucune.
 */
export function dureeRetenueSecondes(
  client: number | undefined,
  sdk: number | undefined,
  octets?: number
): number {
  const plancher =
    typeof octets === 'number' && Number.isFinite(octets) && octets > 0
      ? octets / OCTETS_PAR_SECONDE_PLANCHER
      : undefined
  const valeurs = [client, sdk, plancher].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  )
  return valeurs.length === 0 ? 0 : borner(Math.max(...valeurs))
}

/** Cout en USD d'une dictee OpenAI ; 0 si le modele n'a pas de tarif connu. */
export function coutTranscriptionUsd(modele: string, dureeSecondes: number): number {
  const parMinute = TARIF_TRANSCRIPTION_USD_PAR_MINUTE[modele]
  if (parMinute === undefined) return 0
  return arrondirCout((borner(dureeSecondes) / 60) * parMinute)
}
