'use client'

import { useTranslations } from 'next-intl'
import { useFormState, useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { demanderLienAction } from './actions'

function Envoyer() {
  const t = useTranslations('ecrans.motDePasseOublie')
  const { pending } = useFormStatus()
  return <Button disabled={pending}>{pending ? t('envoi') : t('envoyer')}</Button>
}

export function FormulaireDemande() {
  const t = useTranslations('ecrans.motDePasseOublie')
  const [etat, action] = useFormState(demanderLienAction, {})
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="email">{t('adresse')}</Label>
        <Input id="email" name="email" type="email" autoComplete="username" maxLength={254} required />
      </div>
      {etat.confirmation && <p role="status" className="text-sm">{etat.confirmation}</p>}
      <Envoyer />
    </form>
  )
}
