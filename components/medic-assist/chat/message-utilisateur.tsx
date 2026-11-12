'use client'

import { useTranslations } from 'next-intl'
import { texteDuMessage } from '@/lib/medic-assist/client/texte-brut'
import type { MessageUI } from '@/lib/medic-assist/client/types'

/** Forme libre, facultative, des metadonnees d'un message utilisateur. */
function lireMetadonnees(metadata: unknown): { noms: string[]; contexte?: string } {
  if (typeof metadata !== 'object' || metadata === null) return { noms: [] }
  const m = metadata as { piecesJointes?: unknown; contexte?: unknown }
  const noms = Array.isArray(m.piecesJointes)
    ? m.piecesJointes
        .map((p) => (typeof p === 'object' && p !== null ? (p as { nom?: unknown }).nom : undefined))
        .filter((n): n is string => typeof n === 'string' && n !== '')
    : []
  return { noms, contexte: typeof m.contexte === 'string' && m.contexte ? m.contexte : undefined }
}

export function MessageUtilisateur({ message }: { message: MessageUI }) {
  const t = useTranslations('medicAssist.fil')
  const texte = texteDuMessage(message)
  const { noms, contexte } = lireMetadonnees(message.metadata)
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="sr-only">{t('vous')}</span>
      {texte ? (
        <div dir="auto" className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-secondary px-4 py-2.5 text-[15px] leading-relaxed">
          {texte}
        </div>
      ) : null}
      {noms.length > 0 ? (
        <p className="max-w-[85%] text-xs text-muted-foreground">
          {t('piecesJointes', { noms: noms.join(', ') })}
        </p>
      ) : null}
      {contexte ? (
        <p className="max-w-[85%] text-xs text-muted-foreground">{t('contexteJoint', { ecran: contexte })}</p>
      ) : null}
    </div>
  )
}
