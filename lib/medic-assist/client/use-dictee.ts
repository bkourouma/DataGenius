"use client"

/**
 * Dictee vocale : reconnaissance du navigateur (SpeechRecognition) quand elle
 * existe, sinon enregistrement (MediaRecorder) transcrit par le serveur.
 *
 * - Le texte remis a `onTexte` est CUMULE depuis le debut de la dictee.
 * - Arret automatique au silence (SpeechRecognition) et apres 120 s (enregistrement :
 *   largement sous LIMITES.tailleMaxAudioOctets, un audio opus pesant ~0,5 Mo pour 2 min).
 * - La duree reelle de l'enregistrement (chrono) est envoyee au serveur avec l'audio.
 * - Les pistes du micro sont toujours coupees a l'arret et au demontage.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { LANGUES_VOIX } from './types'
import { transcribeAudio } from './transcription'
import { CODE_TRANSCRIPTION_INDISPONIBLE, codeErreurApi } from './erreurs-api'
import { LIMITES } from '@/lib/medic-assist/contrats/constantes'

export const DELAI_SILENCE_MS = 2500
export const DUREE_MAX_ENREGISTREMENT_MS = 120_000

export type EtatDictee = 'inactif' | 'ecoute' | 'transcription'
export type CapaciteDictee = 'inconnue' | 'ok' | 'https' | 'indisponible'

export interface OptionsDictee {
  onDebut?: () => void
  onTexte: (texte: string, final: boolean) => void
  onFin?: () => void
}

/** Types minimaux de l'API SpeechRecognition (absente des types DOM de TypeScript). */
interface ResultatReconnaissance {
  readonly [index: number]: { readonly transcript: string } | undefined
}
interface EvenementResultat {
  readonly results: { readonly length: number; readonly [index: number]: ResultatReconnaissance | undefined }
}
interface EvenementErreurReconnaissance {
  readonly error?: string
}
interface ReconnaissanceVocale {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((evenement: EvenementResultat) => void) | null
  onerror: ((evenement: EvenementErreurReconnaissance) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort?: () => void
}

type ConstructeurReconnaissance = new () => ReconnaissanceVocale

interface FenetreVocale {
  SpeechRecognition?: ConstructeurReconnaissance
  webkitSpeechRecognition?: ConstructeurReconnaissance
  MediaRecorder?: typeof MediaRecorder
}

function constructeurReconnaissance(): ConstructeurReconnaissance | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as FenetreVocale
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function enregistrementPossible(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  return (
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof (window as unknown as FenetreVocale).MediaRecorder !== 'undefined'
  )
}

/** `serveurIndisponible` : la transcription serveur a repondu 503, seul le navigateur peut dicter. */
function calculerCapacite(serveurIndisponible: boolean): CapaciteDictee {
  if (typeof window === 'undefined') return 'inconnue'
  if (window.isSecureContext === false) return 'https'
  if (constructeurReconnaissance() || (!serveurIndisponible && enregistrementPossible())) return 'ok'
  return 'indisponible'
}

export function useDictee({ onDebut, onTexte, onFin }: OptionsDictee) {
  const t = useTranslations('medicAssist')
  const locale = useLocale()
  const [capacite, setCapacite] = useState<CapaciteDictee>('inconnue')
  const [etat, setEtat] = useState<EtatDictee>('inactif')
  const [message, setMessage] = useState('')
  // Memorise pour la vie du composant : pas de nouvel essai de la transcription serveur.
  const [serveurIndisponible, setServeurIndisponible] = useState(false)
  const serveurIndispoRef = useRef(false)

  const rappels = useRef({ onDebut, onTexte, onFin })
  rappels.current = { onDebut, onTexte, onFin }
  const traduire = useRef(t)
  traduire.current = t

  const reconnaissance = useRef<ReconnaissanceVocale | null>(null)
  const enregistreur = useRef<MediaRecorder | null>(null)
  const flux = useRef<MediaStream | null>(null)
  const minuteurSilence = useRef<ReturnType<typeof setTimeout> | null>(null)
  const minuteurMax = useRef<ReturnType<typeof setTimeout> | null>(null)
  const actif = useRef(false)
  const montee = useRef(true)
  const dernierTexte = useRef('')
  const annule = useRef(false)

  useEffect(() => {
    setCapacite(calculerCapacite(false))
  }, [])

  const viderMinuteurs = useCallback(() => {
    if (minuteurSilence.current) clearTimeout(minuteurSilence.current)
    if (minuteurMax.current) clearTimeout(minuteurMax.current)
    minuteurSilence.current = null
    minuteurMax.current = null
  }, [])

  const couperPistes = useCallback(() => {
    flux.current?.getTracks().forEach((piste) => piste.stop())
    flux.current = null
  }, [])

  const terminer = useCallback(() => {
    viderMinuteurs()
    couperPistes()
    const etaitActif = actif.current
    actif.current = false
    reconnaissance.current = null
    enregistreur.current = null
    if (!montee.current) return
    setEtat('inactif')
    if (etaitActif) rappels.current.onFin?.()
  }, [couperPistes, viderMinuteurs])

  const signaler = useCallback((cle: string) => {
    const texte = traduire.current(cle as never)
    if (montee.current) setMessage(texte)
    toast.error(texte)
  }, [])

  const demarrerEnregistrement = useCallback(async () => {
    annule.current = false
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (erreur) {
      const nom = (erreur as { name?: string } | null)?.name
      signaler(nom === 'NotAllowedError' || nom === 'SecurityError' ? 'micro.refuse' : 'micro.erreur')
      terminer()
      return
    }
    if (annule.current || !montee.current) {
      stream.getTracks().forEach((piste) => piste.stop())
      if (montee.current) terminer()
      return
    }
    flux.current = stream
    const Enregistreur = (window as unknown as FenetreVocale).MediaRecorder as typeof MediaRecorder
    let rec: MediaRecorder
    try {
      rec = new Enregistreur(stream)
    } catch {
      signaler('micro.erreur')
      terminer()
      return
    }
    const morceaux: Blob[] = []
    let debutMs = 0
    let dureeMs = 0
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) morceaux.push(e.data)
    }
    rec.onerror = () => {
      signaler('micro.erreur')
      terminer()
    }
    rec.onstop = async () => {
      dureeMs = Date.now() - debutMs
      viderMinuteurs()
      couperPistes()
      enregistreur.current = null
      if (annule.current || !montee.current) return
      if (morceaux.length === 0) {
        signaler('micro.silence')
        terminer()
        return
      }
      const blob = new Blob(morceaux, { type: rec.mimeType || 'audio/webm' })
      if (blob.size > LIMITES.tailleMaxAudioOctets) {
        // Le serveur refuserait l'envoi : inutile de le tenter.
        signaler('micro.erreurTranscription')
        terminer()
        return
      }
      setEtat('transcription')
      setMessage(traduire.current('micro.transcription'))
      try {
        const texte = (await transcribeAudio(blob, locale, dureeMs / 1000)).trim()
        if (annule.current || !montee.current) return
        if (texte) rappels.current.onTexte(texte, true)
        else signaler('micro.silence')
      } catch (erreurServeur) {
        if (!annule.current && montee.current) {
          if (codeErreurApi(erreurServeur) === CODE_TRANSCRIPTION_INDISPONIBLE) {
            // Dictee serveur non configuree : on ne reessaie plus, le navigateur prend le relais s'il sait dicter.
            serveurIndispoRef.current = true
            setServeurIndisponible(true)
            setCapacite(calculerCapacite(true))
            signaler(constructeurReconnaissance() ? 'micro.transcriptionIndisponibleRelais' : 'micro.transcriptionIndisponible')
          } else {
            signaler('micro.erreurTranscription')
          }
        }
      }
      if (!annule.current) terminer()
    }
    enregistreur.current = rec
    debutMs = Date.now()
    rec.start()
    setEtat('ecoute')
    setMessage(traduire.current('micro.ecoute'))
    minuteurMax.current = setTimeout(() => {
      if (rec.state !== 'inactive') rec.stop()
    }, DUREE_MAX_ENREGISTREMENT_MS)
  }, [couperPistes, locale, signaler, terminer, viderMinuteurs])

  const demarrer = useCallback(() => {
    if (actif.current || calculerCapacite(serveurIndispoRef.current) !== 'ok') return
    actif.current = true
    dernierTexte.current = ''
    annule.current = false
    rappels.current.onDebut?.()

    const Reconnaissance = constructeurReconnaissance()
    if (!Reconnaissance) {
      void demarrerEnregistrement()
      return
    }

    const rec = new Reconnaissance()
    rec.lang = LANGUES_VOIX[locale] ?? locale
    rec.interimResults = true
    rec.continuous = true
    let bascule = false

    rec.onresult = (evenement) => {
      const resultats = evenement.results
      let texte = ''
      for (let i = 0; i < resultats.length; i++) {
        texte += resultats[i]?.[0]?.transcript ?? ''
      }
      texte = texte.trim()
      dernierTexte.current = texte
      if (texte) rappels.current.onTexte(texte, false)
      if (minuteurSilence.current) clearTimeout(minuteurSilence.current)
      minuteurSilence.current = setTimeout(() => rec.stop(), DELAI_SILENCE_MS)
    }
    rec.onerror = (evenement) => {
      const code: string = evenement?.error ?? ''
      if (code === 'aborted') return
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        signaler('micro.refuse')
      } else if (code === 'no-speech') {
        signaler('micro.silence')
      } else if (!serveurIndispoRef.current && enregistrementPossible()) {
        // network, audio-capture, language-not-supported... : repli serveur
        bascule = true
        viderMinuteurs()
        rec.onresult = null
        rec.onerror = null
        rec.onend = null
        try {
          rec.abort?.()
        } catch {
          // deja arrete
        }
        reconnaissance.current = null
        void demarrerEnregistrement()
      } else {
        signaler('micro.erreur')
      }
    }
    rec.onend = () => {
      if (bascule) return
      if (dernierTexte.current) rappels.current.onTexte(dernierTexte.current, true)
      terminer()
    }

    reconnaissance.current = rec
    try {
      rec.start()
      setEtat('ecoute')
      setMessage(traduire.current('micro.ecoute'))
    } catch {
      signaler('micro.erreur')
      terminer()
    }
  }, [demarrerEnregistrement, locale, signaler, terminer, viderMinuteurs])

  const arreter = useCallback(() => {
    if (!actif.current) return
    if (reconnaissance.current) {
      reconnaissance.current.stop()
    } else if (enregistreur.current) {
      if (enregistreur.current.state !== 'inactive') enregistreur.current.stop()
    } else {
      // getUserMedia en attente
      annule.current = true
      terminer()
    }
  }, [terminer])

  useEffect(() => {
    montee.current = true
    return () => {
      montee.current = false
      annule.current = true
      viderMinuteurs()
      const rec = reconnaissance.current
      if (rec) {
        rec.onresult = rec.onerror = rec.onend = null
        try {
          rec.abort ? rec.abort() : rec.stop()
        } catch {
          // deja arrete
        }
      }
      const enr = enregistreur.current
      if (enr) {
        enr.ondataavailable = enr.onstop = enr.onerror = null
        try {
          if (enr.state !== 'inactive') enr.stop()
        } catch {
          // deja arrete
        }
      }
      couperPistes()
    }
  }, [couperPistes, viderMinuteurs])

  return { capacite, etat, message, serveurIndisponible, demarrer, arreter }
}
