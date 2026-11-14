/**
 * POST /api/medic-assist/transcription : dictee envoyee au serveur (repli quand la dictee
 * du navigateur n'existe pas). Corps multipart : `audio` (fichier), `langue` (facultatif, ISO
 * 639-1, defaut = langue du contexte), `dureeSecondes` (facultatif, nombre). Reponse
 * TranscriptionDto { texte, langue, dureeSecondes }.
 *
 * Ordre des controles : garde d'acces, moteur configure ET dont la cle existe (503
 * `transcriptionIndisponible`, l'interface masque alors le repli), taille annoncee, formulaire,
 * champs, audio (400 / 413).
 * Entre la config et la taille : limite de debit (20 dictees / 10 min / utilisateur, 429
 * `limiteDebit` + Retry-After) puis plafond de cout journalier commun avec le chat (429
 * `quotaEpuise`, `details.reinitialisationA` en ISO). Les erreurs 429 et 5xx portent
 * `details.reference` (reference `DG-XXXXXX`, aussi dans le journal serveur). Le corps est lu en
 * flux avec plafond (413 `audioTropGros` meme en envoi fragmente). Abandon du client : 499 sans
 * corps, aucun usage enregistre. L'audio n'est pas conserve. L'usage est enregistre (cout a la
 * minute), echecs du fournisseur compris (cout 0, code `transcriptionEchec`), sans jamais
 * casser la dictee. Reponses d'erreur : { error: <code>, message } ; l'interface traduit le code.
 */

import { NextRequest, NextResponse } from 'next/server'
import { journal } from '@/lib/journal'

import {
  CHAMPS_TELEVERSEMENT,
  LIMITES,
  exigerMedicAssist,
  lireConfigMedicAssist,
} from '@/lib/medic-assist/admin/dependances'
import { erreurApi } from '@/lib/medic-assist/admin/reponses'
import type { CodeErreurLot6 } from '@/lib/medic-assist/admin/codes-erreur'
import { verifierQuotaJournalier } from '@/lib/medic-assist/agent/quota'
import { genererReference } from '@/lib/medic-assist/agent/reference'
import { CorpsTropVolumineux, lireOctetsBornes, requeteDepuisOctets } from '@/lib/http/corps-borne'
import { limiteurTranscription } from '@/lib/medic-assist/transcription/limite'
import type { TranscriptionDto } from '@/lib/medic-assist/contrats'
import { enregistrerUsageTranscription } from '@/lib/medic-assist/transcription/depot-prisma'
import { moteurTranscriptionEffectif } from '@/lib/medic-assist/transcription/moteur'
import { DUREE_MAX_SECONDES } from '@/lib/medic-assist/transcription/tarifs'
import {
  ErreurTranscription,
  TranscriptionAnnulee,
  LANGUE_PAR_LOCALE,
  transcrire,
} from '@/lib/medic-assist/transcription/transcrire'
import { validerAudio, validerTailleAudio } from '@/lib/medic-assist/transcription/validation-audio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

/** Marge pour l'enveloppe multipart autour du fichier. */
const MARGE_ENVELOPPE_OCTETS = 64 * 1024

/**
 * Refus 429 / 5xx : { error, message, details: { reference, ... } } + en-tetes eventuels. Les codes
 * `limiteDebit` et `quotaEpuise` ne sont pas (encore) dans CODES_ERREUR_LOT_6 : d'ou le cast.
 */
function refusAvecReference(
  status: number,
  code: string,
  message: string,
  reference: string,
  details: Record<string, unknown> = {},
  entetes: Record<string, string> = {}
) {
  const reponse = erreurApi(status, code as CodeErreurLot6, message, { ...details, reference })
  for (const [nom, valeur] of Object.entries(entetes)) reponse.headers.set(nom, valeur)
  return reponse
}

/** Langue demandee : « fr », « fr-FR »... -> « fr » ; undefined si absente, null si invalide. */
function lireLangue(brut: unknown): string | undefined | null {
  if (brut === null || brut === undefined || brut === '') return undefined
  if (typeof brut !== 'string') return null
  const base = brut.trim().toLowerCase().split(/[-_]/)[0] ?? ''
  return /^[a-z]{2}$/.test(base) ? base : null
}

/** Duree annoncee : nombre borne a [0, 3600] ; undefined si absente, null si non numerique. */
function lireDuree(brut: unknown): number | undefined | null {
  if (brut === null || brut === undefined || brut === '') return undefined
  if (typeof brut !== 'string' || brut.trim() === '') return null
  const valeur = Number(brut)
  if (!Number.isFinite(valeur)) return null
  return Math.min(DUREE_MAX_SECONDES, Math.max(0, valeur))
}

export async function POST(request: NextRequest) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse

  let config
  try {
    config = await lireConfigMedicAssist()
  } catch {
    return erreurApi(500, 'erreurServeur', 'Could not read the configuration.')
  }
  const moteur = moteurTranscriptionEffectif(config.transcription)
  if (!moteur) {
    return erreurApi(503, 'transcriptionIndisponible', 'Server-side dictation is not available.')
  }

  const { userId, locale } = garde.contexte

  // Limite de debit puis plafond de cout : avant toute lecture du corps.
  const limiteur = limiteurTranscription()
  const debit = limiteur.consommer(userId)
  if (!debit.accepte) {
    const reference = genererReference()
    journal.erreur('Transcription refusée : limite de débit', { domaine: 'transcription', reference, code: 'limiteDebit' })
    return refusAvecReference(
      429,
      'limiteDebit',
      'Too many dictations. Try again later.',
      reference,
      {},
      { 'Retry-After': String(Math.ceil(debit.reessayerDansMs / 1000)) }
    )
  }
  try {
    const verdict = await verifierQuotaJournalier(userId, config.plafondCoutJournalierUsd)
    if (!verdict.autorise) {
      limiteur.rembourser(userId)
      const reference = genererReference()
      journal.erreur('Transcription refusée : quota épuisé', { domaine: 'transcription', reference, code: 'quotaEpuise' })
      return refusAvecReference(
        429,
        'quotaEpuise',
        'Daily usage limit reached.',
        reference,
        { reinitialisationA: verdict.reinitialisationA.toISOString() },
        {
          'Retry-After': String(
            Math.max(1, Math.ceil((verdict.reinitialisationA.getTime() - Date.now()) / 1000))
          ),
        }
      )
    }
  } catch {
    limiteur.rembourser(userId)
    const reference = genererReference()
    journal.erreur('Vérification du quota impossible', { domaine: 'transcription', reference, code: 'quotaIndisponible' })
    return refusAvecReference(500, 'erreurServeur', 'Could not check the usage limit.', reference)
  }

  const annonce = Number(request.headers.get('content-length'))
  if (Number.isFinite(annonce) && annonce > LIMITES.tailleMaxAudioOctets + MARGE_ENVELOPPE_OCTETS) {
    return erreurApi(413, 'audioTropGros', 'Recording too large (10 MB maximum).')
  }

  let formulaire: FormData
  try {
    const brut = await lireOctetsBornes(
      request,
      LIMITES.tailleMaxAudioOctets + MARGE_ENVELOPPE_OCTETS
    )
    formulaire = await requeteDepuisOctets(request, brut).formData()
  } catch (erreur) {
    if (erreur instanceof CorpsTropVolumineux) {
      return erreurApi(413, 'audioTropGros', 'Recording too large (10 MB maximum).')
    }
    return erreurApi(400, 'validationInvalide', 'Multipart request expected.')
  }
  const fichier = formulaire.get(CHAMPS_TELEVERSEMENT.audio)
  if (!fichier || typeof fichier === 'string') {
    return erreurApi(400, 'audioAbsent', 'Field "audio" is missing.')
  }

  const langueDemandee = lireLangue(formulaire.get(CHAMPS_TELEVERSEMENT.langue))
  const dureeClient = lireDuree(formulaire.get('dureeSecondes'))
  if (langueDemandee === null || dureeClient === null) {
    return erreurApi(400, 'validationInvalide', 'Invalid "langue" or "dureeSecondes".')
  }

  const refusTaille = validerTailleAudio(fichier.size)
  if (refusTaille) return erreurApi(refusTaille.status, refusTaille.code, refusTaille.message)

  const octets = new Uint8Array(await fichier.arrayBuffer())
  const audio = validerAudio({ octets, nom: fichier.name ?? '', typeAnnonce: fichier.type ?? '' })
  if (!audio.ok) return erreurApi(audio.status, audio.code, audio.message)

  try {
    const resultat = await transcrire({
      moteur,
      audio: octets,
      typeMime: audio.typeMime,
      langue: langueDemandee ?? LANGUE_PAR_LOCALE[locale] ?? 'fr',
      dureeSecondesClient: dureeClient,
      signal: request.signal,
    })
    // Echec d'ecriture : sans effet sur la dictee (le depot journalise sans donnee).
    await Promise.resolve(
      enregistrerUsageTranscription({
        userId,
        fournisseur: resultat.fournisseur,
        modele: resultat.modele,
        tokensEntree: resultat.tokensEntree,
        tokensSortie: resultat.tokensSortie,
        coutUsd: resultat.coutUsd,
        dureeMs: resultat.dureeMs,
      })
    ).catch(() => undefined)
    const corps: TranscriptionDto = {
      texte: resultat.texte,
      langue: resultat.langue,
      dureeSecondes: resultat.dureeSecondes,
    }
    return NextResponse.json(corps)
  } catch (erreur) {
    // Abandon du client : pas un echec du fournisseur, rien a enregistrer.
    if (erreur instanceof TranscriptionAnnulee) {
      return new NextResponse(null, { status: 499 })
    }
    await Promise.resolve(
      enregistrerUsageTranscription({
        userId,
        fournisseur: moteur.fournisseur,
        modele: moteur.modele,
        tokensEntree: 0,
        tokensSortie: 0,
        coutUsd: 0,
        dureeMs: erreur instanceof ErreurTranscription ? erreur.dureeMs : 0,
        erreur: 'transcriptionEchec',
      })
    ).catch(() => undefined)
    const reference = genererReference()
    journal.erreur('Échec de la transcription', { domaine: 'transcription', reference, code: 'transcriptionEchec' })
    return refusAvecReference(502, 'transcriptionEchec', 'Transcription failed. Try again.', reference)
  }
}
