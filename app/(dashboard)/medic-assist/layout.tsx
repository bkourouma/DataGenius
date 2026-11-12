import type { ReactNode } from 'react'
import { FournisseurRequetes } from '@/components/medic-assist/chat/fournisseur-requetes'

/**
 * Fournit le QueryClient a toute la route /medic-assist (chat et sous-pages
 * comme analyses/). Le gabarit PLEIN ECRAN du chat n'est pas pose ici mais par
 * `EspaceChat` (composants/medic-assist/chat/gabarit-plein-ecran) : ainsi les
 * sous-pages, qui defilent normalement, ne sont pas bloquees par `overflow-hidden`.
 */
export default function MedicAssistLayout({ children }: { children: ReactNode }) {
  return <FournisseurRequetes>{children}</FournisseurRequetes>
}
