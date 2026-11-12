'use client'

/**
 * Lecture vocale d'une reponse (speechSynthesis du navigateur).
 * Un seul enonce a la fois ; le texte est decoupe en phrases courtes car Chrome
 * coupe les enonces longs (environ 200 caracteres et plus).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { LANGUES_VOIX } from './types'

const LONGUEUR_MAX = 180

/** Decoupe un texte en morceaux de `max` caracteres au plus, a la phrase puis au mot. */
export function decouperEnPhrases(texte: string, max = LONGUEUR_MAX): string[] {
  const phrases = texte
    .split(/(?<=[.!?…؟。！？।])\s+|\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const morceaux: string[] = []
  for (const phrase of phrases) {
    if (phrase.length <= max) {
      morceaux.push(phrase)
      continue
    }
    let courant = ''
    for (const mot of phrase.split(/\s+/)) {
      if (courant && courant.length + 1 + mot.length > max) {
        morceaux.push(courant)
        courant = mot
      } else {
        courant = courant ? `${courant} ${mot}` : mot
      }
    }
    if (courant) morceaux.push(courant)
  }
  return morceaux
}

function apiDisponible(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  )
}

export interface LectureVocale {
  disponible: boolean
  lecturEnCoursId: string | null
  lire: (id: string, texte: string) => void
  arreter: () => void
}

export function useLectureVocale(): LectureVocale {
  const locale = useLocale()
  const [disponible, setDisponible] = useState(false)
  const [lecturEnCoursId, setLecturEnCoursId] = useState<string | null>(null)
  const jeton = useRef(0)
  const actif = useRef(false)

  useEffect(() => {
    setDisponible(apiDisponible())
  }, [])

  const arreter = useCallback(() => {
    jeton.current += 1
    if (actif.current && apiDisponible()) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        // synthese indisponible : rien a arreter
      }
    }
    actif.current = false
    setLecturEnCoursId(null)
  }, [])

  const lire = useCallback(
    (id: string, texte: string) => {
      if (!apiDisponible()) return
      const synthese = window.speechSynthesis
      const morceaux = decouperEnPhrases(texte)
      if (morceaux.length === 0) return

      jeton.current += 1
      const monJeton = jeton.current
      try {
        synthese.cancel()
      } catch {
        // ignore
      }

      const langue = LANGUES_VOIX[locale] ?? locale
      const code = langue.split('-')[0].toLowerCase()
      let voix: SpeechSynthesisVoice | undefined
      try {
        const voix_ = synthese.getVoices?.() ?? []
        voix =
          voix_.find((v) => v.lang.toLowerCase() === langue.toLowerCase()) ??
          voix_.find((v) => v.lang.toLowerCase().startsWith(code))
      } catch {
        voix = undefined
      }

      actif.current = true
      setLecturEnCoursId(id)
      const terminer = () => {
        if (jeton.current !== monJeton) return
        actif.current = false
        setLecturEnCoursId(null)
      }

      morceaux.forEach((morceau, index) => {
        const enonce = new window.SpeechSynthesisUtterance(morceau)
        enonce.lang = voix?.lang ?? langue
        if (voix) enonce.voice = voix
        if (index === morceaux.length - 1) enonce.onend = terminer
        enonce.onerror = terminer
        synthese.speak(enonce)
      })
    },
    [locale],
  )

  useEffect(() => {
    return () => {
      jeton.current += 1
      if (actif.current && apiDisponible()) {
        try {
          window.speechSynthesis.cancel()
        } catch {
          // ignore
        }
      }
    }
  }, [])

  return { disponible, lecturEnCoursId, lire, arreter }
}
