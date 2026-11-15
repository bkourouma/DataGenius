'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

export function Consentement({ tableau, origine, nonce }: { tableau: string; origine: string; nonce: string }) {
  const t = useTranslations('tableaux.integration')
  const [statut, definir] = useState<'pret' | 'envoi' | 'envoye' | 'erreur'>('pret')

  async function autoriser() {
    const application = window.opener
    if (!application) return definir('erreur')
    definir('envoi')
    try {
      const reponse = await fetch('/api/v1/integration/autorisation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tableau, origine }),
      })
      if (!reponse.ok) throw new Error()
      const { jeton } = await reponse.json()
      application.postMessage({ type: 'datagenius:autorisation', nonce, jeton }, origine)
      definir('envoye')
      window.close()
    } catch {
      definir('erreur')
    }
  }

  return <div className="space-y-3">
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button onClick={autoriser} loading={statut === 'envoi'} disabled={statut === 'envoye'}>{t('autoriser')}</Button>
      <Button variant="outline" onClick={() => window.close()}>{t('fermer')}</Button>
    </div>
    {statut === 'erreur' && <p role="alert" className="text-sm text-destructive">{t('erreur')}</p>}
    {statut === 'envoye' && <p role="status" className="text-sm text-muted-foreground">{t('envoye')}</p>}
  </div>
}
