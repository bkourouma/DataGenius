'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function Consentement({ tableau, origine, nonce }: { tableau: string; origine: string; nonce: string }) {
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
    <div className="flex flex-wrap gap-2">
      <Button onClick={autoriser} disabled={statut === 'envoi' || statut === 'envoye'}>Autoriser l’affichage</Button>
      <Button variant="outline" onClick={() => window.close()}>Fermer</Button>
    </div>
    {statut === 'erreur' && <p role="alert">Relancez l’autorisation depuis l’application hôte.</p>}
    {statut === 'envoye' && <p role="status">Autorisation transmise.</p>}
  </div>
}
