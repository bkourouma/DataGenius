"use client"

/**
 * Memorise les reglages d'affichage d'une grille dans le navigateur.
 *
 * Ce qui est memorise appartient a l'utilisateur et non aux donnees : colonnes
 * masquees, densite, largeurs redimensionnees. Les filtres et le
 * tri ne le sont pas volontairement : on retrouve une grille dans son etat neutre
 * a chaque visite, ce qui evite de croire a une perte de donnees quand un filtre
 * oublie masquait des lignes.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { ColumnSizingState, VisibilityState } from "@tanstack/react-table"
import type { GridDensity } from "./types"

export interface GridPreferences {
  columnVisibility: VisibilityState
  columnSizing: ColumnSizingState
  density: GridDensity
}

const PREFIX = "medicpro.grid."

function read(storageKey: string): Partial<GridPreferences> | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed ? parsed : null
  } catch {
    return null
  }
}

export function useGridPreferences(
  storageKey: string | undefined,
  defaults: GridPreferences
) {
  // Le rendu initial doit etre identique cote serveur et cote client : on part
  // des valeurs par defaut, puis on applique la preference apres montage.
  const [preferences, setPreferences] = useState<GridPreferences>(defaults)
  const [hydrated, setHydrated] = useState(false)
  const defaultsRef = useRef(defaults)

  useEffect(() => {
    if (!storageKey) {
      setHydrated(true)
      return
    }
    const stored = read(storageKey)
    if (stored) {
      setPreferences({
        columnVisibility: stored.columnVisibility ?? defaultsRef.current.columnVisibility,
        columnSizing: stored.columnSizing ?? defaultsRef.current.columnSizing,
        density: stored.density ?? defaultsRef.current.density,
      })
    }
    setHydrated(true)
  }, [storageKey])

  useEffect(() => {
    if (!storageKey || !hydrated) return
    try {
      window.localStorage.setItem(PREFIX + storageKey, JSON.stringify(preferences))
    } catch {
      // Stockage indisponible : les reglages valent pour la session en cours.
    }
  }, [storageKey, hydrated, preferences])

  const update = useCallback(<K extends keyof GridPreferences>(key: K, value: GridPreferences[K]) => {
    setPreferences((previous) => (previous[key] === value ? previous : { ...previous, [key]: value }))
  }, [])

  const reset = useCallback(() => {
    setPreferences(defaultsRef.current)
    if (!storageKey) return
    try {
      window.localStorage.removeItem(PREFIX + storageKey)
    } catch {
      // Rien a nettoyer si le stockage est indisponible.
    }
  }, [storageKey])

  // `hydrated` : les preferences memorisees sont lues (ou il n'y en a pas).
  return { preferences, update, reset, hydrated }
}
