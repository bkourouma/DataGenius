'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { appliquerLangueEnregistree } from '@/i18n/actions'

/**
 * Rendu seulement quand aucun cookie de langue n'existe alors que le profil en
 * mémorise une autre que le français (connexion entreprise, nouvel appareil) :
 * applique cette langue une fois, puis rafraîchit la page pour la traduire.
 */
export function SynchroLangue() {
  const router = useRouter()
  const fait = useRef(false)
  useEffect(() => {
    if (fait.current) return
    fait.current = true
    appliquerLangueEnregistree()
      .then(({ ok }) => {
        if (ok) router.refresh()
      })
      .catch(() => {})
  }, [router])
  return null
}
