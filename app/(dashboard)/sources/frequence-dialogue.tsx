'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { FormulaireFrequence } from './formulaires'

export function FrequenceDialogue({ cle, titre, frequence }: { cle: string; titre: string; frequence: number }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Modifier la fréquence<span className="sr-only"> de {titre}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fréquence de synchronisation</DialogTitle>
          <DialogDescription>{titre} · actuellement toutes les {frequence} min</DialogDescription>
        </DialogHeader>
        <DialogBody><FormulaireFrequence cle={cle} frequence={frequence} /></DialogBody>
      </DialogContent>
    </Dialog>
  )
}
