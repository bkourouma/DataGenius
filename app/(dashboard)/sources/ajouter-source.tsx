'use client'

import { useState } from 'react'
import { Database, FileSpreadsheet, Globe, Plus, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FormulaireConnexion, FormulaireConnexionRest, FormulaireFichierSource } from './formulaires'

const tuiles = [
  { valeur: 'postgresql', libelle: 'PostgreSQL', aide: 'Base relationnelle en lecture seule', Icone: Database },
  { valeur: 'mysql', libelle: 'MySQL', aide: 'Base MySQL ou MariaDB en lecture seule', Icone: Server },
  { valeur: 'rest', libelle: 'API REST', aide: 'Service web qui renvoie du JSON', Icone: Globe },
  { valeur: 'fichier', libelle: 'Fichier CSV ou Excel', aide: 'Import ponctuel depuis votre poste', Icone: FileSpreadsheet },
] as const

export function AjouterSource() {
  const [type, setType] = useState('')
  return (
    <Tabs value={type} onValueChange={setType} className="space-y-3">
      <TabsList
        aria-label="Type de source à ajouter"
        className="grid h-auto w-full grid-cols-2 gap-2 border-0 bg-transparent p-0 sm:grid-cols-4"
      >
        {tuiles.map(({ valeur, libelle, aide, Icone }) => (
          <TabsTrigger
            key={valeur}
            value={valeur}
            className="h-auto flex-col items-start gap-1 whitespace-normal rounded-md border bg-card p-3 text-start text-foreground hover:border-primary/60 data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-none"
          >
            <Icone className="size-5 text-primary" aria-hidden />
            <span className="text-sm font-semibold">{libelle}</span>
            <span className="text-xs font-normal text-muted-foreground">{aide}</span>
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
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Plus className="size-4" aria-hidden />Ajouter une source
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ajouter une source</DialogTitle>
          <DialogDescription>Choisissez le type de source, puis renseignez sa connexion.</DialogDescription>
        </DialogHeader>
        <DialogBody><AjouterSource /></DialogBody>
      </DialogContent>
    </Dialog>
  )
}
