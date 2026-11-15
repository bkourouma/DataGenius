'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'
import { PencilLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { enregistrerComplement, type EtatComplement } from '@/app/(dashboard)/glossaire/actions'

function Envoyer() {
  const t = useTranslations('glossaire.page.formulaire')
  const { pending } = useFormStatus()
  return <Button type="submit" size="sm" loading={pending}>{pending ? t('enregistrement') : t('enregistrer')}</Button>
}

/** Formulaire administrateur : complément de définition et synonymes (un par ligne) d'un indicateur. */
export function FormulaireComplement({
  jeu,
  indicateur,
  definition,
  synonymes,
}: {
  jeu: string
  indicateur: string
  definition: string
  synonymes: string[]
}) {
  const t = useTranslations('glossaire.page')
  const [ouvert, setOuvert] = useState(false)
  const [etat, action] = useFormState<EtatComplement, FormData>(enregistrerComplement, {})
  const id = `complement-${jeu}-${indicateur}`

  if (!ouvert) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOuvert(true)} aria-expanded={false} aria-controls={id}>
        <PencilLine aria-hidden />{t('completer')}
      </Button>
    )
  }
  return (
    <form id={id} action={action} className="w-full space-y-3 rounded-md border bg-muted/30 p-3">
      <input type="hidden" name="jeu" value={jeu} />
      <input type="hidden" name="indicateur" value={indicateur} />
      <div className="space-y-1">
        <Label htmlFor={`${id}-definition`}>{t('formulaire.definition')}</Label>
        <Textarea id={`${id}-definition`} name="definition" maxLength={600} rows={3} defaultValue={definition} />
        <p className="text-xs text-muted-foreground">{t('formulaire.aideDefinition')}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-synonymes`}>{t('formulaire.synonymes')}</Label>
        <Textarea id={`${id}-synonymes`} name="synonymes" rows={3} defaultValue={synonymes.join('\n')} />
        <p className="text-xs text-muted-foreground">{t('formulaire.aideSynonymes')}</p>
      </div>
      {etat.erreur && <p role="alert" className="text-sm text-destructive">{t(`erreurs.${etat.erreur}`)}</p>}
      {etat.succes && <p role="status" className="text-sm text-success">{t('formulaire.succes')}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Envoyer />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOuvert(false)}>{t('formulaire.fermer')}</Button>
      </div>
    </form>
  )
}
