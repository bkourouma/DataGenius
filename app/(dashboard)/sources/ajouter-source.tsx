'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Database, FileSpreadsheet, Globe, Plus, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FormulaireConnexion, FormulaireConnexionRest, FormulaireFichierSource } from './formulaires'

const tuiles = [
  { valeur: 'postgresql', Icone: Database },
  { valeur: 'mysql', Icone: Server },
  { valeur: 'rest', Icone: Globe },
  { valeur: 'fichier', Icone: FileSpreadsheet },
] as const

export function AjouterSource() {
  const t = useTranslations('sources.ajout')
  const [type, setType] = useState('')
  return (
    <Tabs value={type} onValueChange={setType} className="space-y-3">
      <TabsList
        aria-label={t('typeAjouter')}
        className="grid h-auto w-full grid-cols-2 gap-2 border-0 bg-transparent p-0 sm:grid-cols-4"
      >
        {tuiles.map(({ valeur, Icone }) => (
          <TabsTrigger
            key={valeur}
            value={valeur}
            className="h-auto flex-col items-start gap-1 whitespace-normal rounded-md border bg-card p-3 text-start text-foreground hover:border-primary/60 data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-none"
          >
            <Icone className="size-5 text-primary" aria-hidden />
            <span className="text-sm font-semibold">{t('tuile.' + valeur + '.libelle')}</span>
            <span className="text-xs font-normal text-muted-foreground">{t('tuile.' + valeur + '.aide')}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="postgresql" className="mt-0 border-t pt-5"><FormulaireConnexion /></TabsContent>
      <TabsContent value="mysql" className="mt-0 border-t pt-5"><FormulaireConnexion moteur="mysql" /></TabsContent>
      <TabsContent value="rest" className="mt-0 border-t pt-5"><FormulaireConnexionRest /></TabsContent>
      <TabsContent value="fichier" className="mt-0 border-t pt-5"><FormulaireFichierSource /></TabsContent>
    </Tabs>
  )
}

/** Déclencheur réutilisable : ouvre le dialogue d’ajout de source. */
export function BoutonAjouterSource({ variant = 'default' }: { variant?: 'default' | 'outline' }) {
  const t = useTranslations('sources.ajout')
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Plus className="size-4" aria-hidden />{t('ajouter')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('ajouter')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody><AjouterSource /></DialogBody>
      </DialogContent>
    </Dialog>
  )
}
