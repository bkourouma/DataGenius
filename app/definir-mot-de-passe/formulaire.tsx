'use client'

import { useTranslations } from 'next-intl'
import { useFormState, useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { definirMotDePasseAction } from './actions'

// Miroir de MOT_DE_PASSE_MIN (lib/auth/comptes-regles.ts, serveur uniquement).
const MIN_MOT_DE_PASSE = 12

function Valider() {
  const t = useTranslations('ecrans.definirMotDePasse')
  const { pending } = useFormStatus()
  return <Button disabled={pending}>{pending ? t('enregistrement') : t('enregistrer')}</Button>
}

export function FormulaireDefinition({ jeton }: { jeton: string }) {
  const t = useTranslations('ecrans.definirMotDePasse')
  const [etat, action] = useFormState(definirMotDePasseAction, {})
  const champ = { minLength: MIN_MOT_DE_PASSE, maxLength: 256, autoComplete: 'new-password', required: true } as const
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="jeton" value={jeton} />
      <div className="grid gap-2">
        <Label htmlFor="motDePasse">{t('nouveauMotDePasse')}</Label>
        <PasswordInput id="motDePasse" name="motDePasse" aria-describedby="aide-mdp" {...champ} />
        <p id="aide-mdp" className="text-xs text-muted-foreground">{t('aide', { min: String(MIN_MOT_DE_PASSE) })}</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirmation">{t('confirmer')}</Label>
        <PasswordInput id="confirmation" name="confirmation" {...champ} />
      </div>
      {etat.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
      <Valider />
    </form>
  )
}
