'use client'

import { useEffect, useState } from 'react'

/** Raccourci de la palette : ⌘K sur Mac, Ctrl K ailleurs (lu apres montage pour eviter un ecart d'hydratation). */
export function useRaccourciPalette(): string {
  const [libelle, setLibelle] = useState('Ctrl K')
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setLibelle('⌘K')
  }, [])
  return libelle
}
