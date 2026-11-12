'use client'

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ErreurApiMedicAssist } from '@/lib/medic-assist/client/api'

/**
 * QueryClient propre a la route /medic-assist (il n'existe pas de fournisseur
 * global dans le tableau de bord). Cree une seule fois par montage.
 */
export function FournisseurRequetes({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Une reponse 4xx (conversation introuvable, acces refuse) ne se corrige pas en reessayant.
            retry: (essais, erreur) =>
              !(erreur instanceof ErreurApiMedicAssist && erreur.statut >= 400 && erreur.statut < 500) &&
              essais < 2,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
