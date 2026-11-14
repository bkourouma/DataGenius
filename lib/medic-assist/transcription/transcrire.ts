/**
 * Transcription d'un enregistrement vocal (dictee envoyee au serveur).
 *
 * Fournisseur et modele viennent de la configuration (`config.transcription`) :
 *   - openai : `transcribe({ model: openai.transcription(modele), audio, providerOptions })` ;
 *     cout = minutes x tarif par minute (tarifs.ts) ;
 *   - google : modele de transcription (identifiant contenant « transcribe », ex.
 *     gemini-3.5-transcribe) -> `transcribe()` avec `google.transcription(modele)` ; sinon
 *     `generateText` avec l'audio en entree (modele de langage configure). Cout : jetons x tarif
 *     du modele quand `tarifModele` le connait, sinon 0 (documente dans tarifs.ts).
 * Voir sdk-ia.ts pour les signatures verifiees.
 *
 * Aucun appel reseau dans les tests : le SDK est injecte (`SdkIa`). L'audio n'est jamais
 * conserve. Aucune erreur du fournisseur n'est propagee telle quelle : elle peut contenir la
 * cle ou un extrait de la reponse.
 */

import type { Locale } from '@/i18n/config'

import { tarifModele } from '../admin/dependances'
import type { MoteurTranscription } from './moteur'
import { chargerSdkIa, type SdkIa } from './sdk-ia'
import { arrondirCout, coutTranscriptionUsd, dureeRetenueSecondes } from './tarifs'

export const DELAI_TRANSCRIPTION_MS = 60_000

/** Langue par defaut de chaque locale de l'interface (ISO 639-1). */
export const LANGUE_PAR_LOCALE: Record<Locale, string> = {
  fr: 'fr',
  en: 'en',
  es: 'es',
  zh: 'zh',
  ar: 'ar',
  hi: 'hi',
}

export interface DemandeTranscription {
  moteur: MoteurTranscription
  audio: Uint8Array
  /** Type MIME retenu apres validation (audio/webm, audio/ogg, audio/mp4, audio/wav). */
  typeMime: string
  /** Langue parlee, ISO 639-1 (deja normalisee par la route). */
  langue: string
  /** Duree annoncee par le client (secondes), non fiable : voir tarifs.ts. */
  dureeSecondesClient?: number
  /** Signal de la requete : l'abandon du client annule l'appel au fournisseur. */
  signal?: AbortSignal
}

export interface ResultatTranscription {
  texte: string
  langue: string
  dureeSecondes: number
  fournisseur: MoteurTranscription['fournisseur']
  modele: string
  tokensEntree: number
  tokensSortie: number
  coutUsd: number
  dureeMs: number
}

export interface DependancesTranscription {
  sdk?: () => Promise<SdkIa>
  delaiMs?: number
  /** Horloge injectable pour mesurer la duree. */
  maintenant?: () => number
}

/** Erreur de transcription deja assainie : le code est stable, le message est generique. */
export class ErreurTranscription extends Error {
  readonly code = 'transcriptionEchec'
  readonly dureeMs: number
  constructor(dureeMs: number) {
    super('Transcription failed.')
    this.name = 'ErreurTranscription'
    this.dureeMs = dureeMs
  }
}

/** Le client a abandonne la requete : ce n'est pas un echec du fournisseur. */
export class TranscriptionAnnulee extends Error {
  readonly code = 'annule'
  constructor() {
    super('Transcription cancelled.')
    this.name = 'TranscriptionAnnulee'
  }
}

function consigneGemini(langue: string): string {
  return (
    `Transcribe this audio recording faithfully, word for word. The spoken language is ` +
    `"${langue}" (ISO 639-1). Reply with the transcription only: no comment, no ` +
    `translation, no quotation marks.`
  )
}

function nombre(valeur: unknown): number {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : 0
}

const estModeleDeTranscription = (modele: string) => /transcribe/i.test(modele)

export async function transcrire(
  demande: DemandeTranscription,
  deps: DependancesTranscription = {}
): Promise<ResultatTranscription> {
  const charger = deps.sdk ?? chargerSdkIa
  const maintenant = deps.maintenant ?? Date.now
  const delaiMs = deps.delaiMs ?? DELAI_TRANSCRIPTION_MS
  const { fournisseur, modele } = demande.moteur
  const debut = maintenant()

  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), delaiMs)
  const signalClient = demande.signal
  const surAbandon = () => controleur.abort()
  if (signalClient?.aborted) controleur.abort()
  else signalClient?.addEventListener('abort', surAbandon, { once: true })
  try {
    const sdk = await charger()
    let texte: string
    let langueDetectee: string | undefined
    let dureeSdk: number | undefined
    let tokensEntree = 0
    let tokensSortie = 0

    if (fournisseur === 'google' && !estModeleDeTranscription(modele)) {
      const resultat = await sdk.generateText({
        model: sdk.modeleGoogle(modele),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: consigneGemini(demande.langue) },
              { type: 'file', mediaType: demande.typeMime, data: demande.audio },
            ],
          },
        ],
        abortSignal: controleur.signal,
      })
      texte = resultat.text
      tokensEntree = nombre(resultat.usage?.inputTokens)
      tokensSortie = nombre(resultat.usage?.outputTokens)
    } else {
      const resultat = await sdk.transcribe({
        model:
          fournisseur === 'openai'
            ? sdk.modeleTranscriptionOpenai(modele)
            : sdk.modeleTranscriptionGoogle(modele),
        audio: demande.audio,
        providerOptions:
          fournisseur === 'openai'
            ? { openai: { language: demande.langue } }
            : { google: { languageCodes: [demande.langue] } },
        abortSignal: controleur.signal,
      })
      texte = resultat.text
      langueDetectee = resultat.language
      dureeSdk = resultat.durationInSeconds
    }

    const dureeSecondes = dureeRetenueSecondes(
      demande.dureeSecondesClient,
      dureeSdk,
      demande.audio.byteLength
    )
    let coutUsd = 0
    if (fournisseur === 'openai') {
      coutUsd = coutTranscriptionUsd(modele, dureeSecondes)
    } else if (tokensEntree + tokensSortie > 0) {
      const tarif = tarifModele(fournisseur, modele)
      if (tarif) {
        coutUsd = arrondirCout(
          (tokensEntree * tarif.entreeUsdParMillion + tokensSortie * tarif.sortieUsdParMillion) /
            1_000_000
        )
      }
    }

    return {
      texte: (texte ?? '').trim(),
      langue: langueDetectee || demande.langue,
      dureeSecondes,
      fournisseur,
      modele,
      tokensEntree,
      tokensSortie,
      coutUsd,
      dureeMs: Math.max(0, maintenant() - debut),
    }
  } catch (erreur) {
    // Abandon du client (et non delai interne) : aucun echec du fournisseur a compter.
    if (signalClient?.aborted) throw new TranscriptionAnnulee()
    // Journal sans donnee : ni message du SDK (il peut citer la cle ou le corps de la
    // reponse), ni texte, ni audio. Seuls le fournisseur, le nom de l'erreur et le statut HTTP.
    const e = erreur as { name?: unknown; statusCode?: unknown }
    console.error('[medic-assist] transcription en echec', {
      fournisseur,
      erreur: typeof e?.name === 'string' ? e.name : 'inconnue',
      statut: typeof e?.statusCode === 'number' ? e.statusCode : undefined,
    })
    throw new ErreurTranscription(Math.max(0, maintenant() - debut))
  } finally {
    clearTimeout(minuteur)
    signalClient?.removeEventListener('abort', surAbandon)
  }
}
