/**
 * POST /api/medic-assist/transcription : dictee envoyee au serveur (repli quand la dictee
 * du navigateur n'existe pas). Corps multipart : `audio` (fichier), `langue` (facultatif, ISO
 * 639-1, defaut = langue du contexte), `dureeSecondes` (facultatif, nombre). Reponse
 * TranscriptionDto { texte, langue, dureeSecondes }.
 *
 * Ordre des controles : garde d'acces, moteur configure ET dont la cle existe (503
 * `transcriptionIndisponible`, l'interface masque alors le repli), taille annoncee, formulaire,
 * champs, audio (400 / 413). L'audio n'est pas conserve. L'usage est enregistre (cout a la
 * minute), echecs du fournisseur compris (cout 0, code `transcriptionEchec`), sans jamais
 * casser la dictee. Reponses d'erreur : { error: <code>, message } ; l'interface traduit le code.
 */

import { NextRequest, NextResponse } from 'next/server'

import {
  CHAMPS_TELEVERSEMENT,
  LIMITES,
  exigerMedicAssist,
  lireConfigMedicAssist,
} from '@/lib/medic-assist/admin/imports-lot0-lot1'
import { erreurApi } from '@/lib/medic-assist/admin/reponses'
import type { TranscriptionDto } from '@/lib/medic-assist/contrats'
import { enregistrerUsageTranscription } from '@/lib/medic-assist/transcription/depot-prisma'
import { moteurTranscriptionEffectif } from '@/lib/medic-assist/transcription/moteur'
import { DUREE_MAX_SECONDES } from '@/lib/medic-assist/transcription/tarifs'
import {
  ErreurTranscription,
  LANGUE_PAR_LOCALE,
  transcrire,
} from '@/lib/medic-assist/transcription/transcrire'
import { validerAudio, validerTailleAudio } from '@/lib/medic-assist/transcription/validation-audio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

/** Marge pour l'enveloppe multipart autour du fichier. */
const MARGE_ENVELOPPE_OCTETS = 64 * 1024

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

  const annonce = Number(request.headers.get('content-length'))
  if (Number.isFinite(annonce) && annonce > LIMITES.tailleMaxAudioOctets + MARGE_ENVELOPPE_OCTETS) {
    return erreurApi(413, 'audioTropGros', 'Recording too large (10 MB maximum).')
  }

  let formulaire: FormData
  try {
    formulaire = await request.formData()
  } catch {
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

  const { userId, locale } = garde.contexte
  try {
    const resultat = await transcrire({
      moteur,
      audio: octets,
      typeMime: audio.typeMime,
      langue: langueDemandee ?? LANGUE_PAR_LOCALE[locale] ?? 'fr',
      dureeSecondesClient: dureeClient,
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
    return erreurApi(502, 'transcriptionEchec', 'Transcription failed. Try again.')
  }
}
