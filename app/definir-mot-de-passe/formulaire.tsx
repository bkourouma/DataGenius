'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { definirMotDePasseAction } from './actions'

function Valider() {
  const { pending } = useFormStatus()
  return <Button disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</Button>
}

export function FormulaireDefinition({ jeton }: { jeton: string }) {
  const [etat, action] = useFormState(definirMotDePasseAction, {})
  const champ = { minLength: 12, maxLength: 256, autoComplete: 'new-password', required: true } as const
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="jeton" value={jeton} />
      <div className="grid gap-2">
        <Label htmlFor="motDePasse">Nouveau mot de passe</Label>
        <PasswordInput id="motDePasse" name="motDePasse" aria-describedby="aide-mdp" {...champ} />
        <p id="aide-mdp" className="text-xs text-muted-foreground">12 caractères minimum</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirmation">Confirmer le mot de passe</Label>
        <PasswordInput id="confirmation" name="confirmation" {...champ} />
      </div>
      {etat.erreur && <p role="alert" className="text-sm text-destructive">{etat.erreur}</p>}
      <Valider />
    </form>
  )
}
