'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { BookMarked, CornerDownLeft, LayoutDashboard, Plus, Search, Sparkles, type LucideIcon } from 'lucide-react'
import { construireContexteEcran, useContexteEcranMedicAssist } from '@/lib/medic-assist/client/contexte-ecran'
import { cn } from '@/lib/utils'
import { listerAnalysesApi } from '@/components/medic-assist/suivi/api-analyses'
import type { AnalyseResumeJson } from '@/lib/medic-assist/suivi/analyses'
import type { GroupeNavigation } from './navigation'

interface Commande {
  id: string
  section: 'Aller à' | 'Tableaux' | 'Analyses' | 'Demander'
  libelle: string
  detail?: string
  icone: LucideIcon
  executer: () => void
}

/** Minuscules sans accents, pour comparer « parametres » et « Paramètres ». */
function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function PaletteCommandes({
  ouverte,
  onOuverteChange,
  groupes,
  tableaux = [],
}: {
  ouverte: boolean
  onOuverteChange: (ouverte: boolean) => void
  groupes: GroupeNavigation[]
  tableaux?: { id: string; titre: string }[]
}) {
  const router = useRouter()
  const chemin = usePathname()
  const [requete, setRequete] = useState('')
  const [indexActif, setIndexActif] = useState(0)
  const idListe = useId()
  const refListe = useRef<HTMLUListElement>(null)
  const [analyses, setAnalyses] = useState<AnalyseResumeJson[]>([])

  // Recherche dans les analyses enregistrees, avec anti-rebond ; une erreur laisse la liste vide.
  useEffect(() => {
    const terme = requete.trim()
    if (!ouverte || terme.length < 2) {
      setAnalyses([])
      return
    }
    const controle = new AbortController()
    const minuterie = window.setTimeout(() => {
      listerAnalysesApi({ q: terme, page: 1 }, controle.signal)
        .then((r) => setAnalyses(r.data.slice(0, 5)))
        .catch(() => {
          if (!controle.signal.aborted) setAnalyses([])
        })
    }, 220)
    return () => {
      window.clearTimeout(minuterie)
      controle.abort()
    }
  }, [requete, ouverte])

  useEffect(() => {
    if (!ouverte) {
      setRequete('')
      setIndexActif(0)
    }
  }, [ouverte])

  const commandes = useMemo<Commande[]>(() => {
    const fermer = () => onOuverteChange(false)
    const question = requete.trim()
    const liste: Commande[] = []

    const filtre = normaliser(question)
    const correspond = (...textes: (string | undefined)[]) =>
      !filtre || filtre.split(/\s+/).every((mot) => textes.some((t) => t && normaliser(t).includes(mot)))

    if (correspond('Nouvelle conversation', 'chat question')) {
      liste.push({
        id: 'nouvelle',
        section: 'Aller à',
        libelle: 'Nouvelle conversation',
        icone: Plus,
        executer: () => {
          fermer()
          router.push('/assistant')
        },
      })
    }
    for (const groupe of groupes) {
      for (const entree of groupe.entrees) {
        if (!correspond(entree.libelle, entree.motsCles, groupe.libelle)) continue
        liste.push({
          id: entree.href,
          section: 'Aller à',
          libelle: entree.libelle,
          detail: groupe.id === 'administration' ? 'Administration' : undefined,
          icone: entree.icone,
          executer: () => {
            fermer()
            router.push(entree.href)
          },
        })
      }
    }
    if (filtre) {
      for (const tableau of tableaux.filter((t) => correspond(t.titre)).slice(0, 5)) {
        liste.push({
          id: 'tableau-' + tableau.id,
          section: 'Tableaux',
          libelle: tableau.titre,
          icone: LayoutDashboard,
          executer: () => {
            fermer()
            router.push('/tableaux/' + encodeURIComponent(tableau.id))
          },
        })
      }
    }

    for (const analyse of analyses) {
      liste.push({
        id: 'analyse-' + analyse.artefactId,
        section: 'Analyses',
        libelle: analyse.titre,
        detail: analyse.sousTitre ?? undefined,
        icone: BookMarked,
        executer: () => {
          fermer()
          router.push('/assistant/analyses/' + encodeURIComponent(analyse.artefactId))
        },
      })
    }

    // La question vient apres les pages : « tableaux » + Entree ouvre la page.
    if (question) {
      liste.push({
        id: 'demander',
        section: 'Demander',
        libelle: question,
        detail: 'Poser la question à l’assistant',
        icone: Sparkles,
        executer: () => {
          // Hors du chat, la page d'ou part la question l'accompagne comme contexte.
          const contexte =
            chemin && chemin !== '/assistant'
              ? construireContexteEcran(
                  chemin,
                  window.location.search,
                  document.title,
                  useContexteEcranMedicAssist.getState().enregistre,
                ) ?? undefined
              : undefined
          useContexteEcranMedicAssist.getState().deposerDemande({ question: question.slice(0, 4000), contexte })
          fermer()
          router.push('/assistant')
        },
      })
    }

    return liste
  }, [requete, groupes, chemin, router, onOuverteChange, analyses, tableaux])

  useEffect(() => {
    setIndexActif(0)
  }, [requete])

  useEffect(() => {
    refListe.current
      ?.querySelector<HTMLElement>(`[data-index="${indexActif}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [indexActif])

  const surTouche = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndexActif((i) => (commandes.length ? (i + 1) % commandes.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndexActif((i) => (commandes.length ? (i - 1 + commandes.length) % commandes.length : 0))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      commandes[indexActif]?.executer()
    }
  }

  const idOption = (i: number) => `${idListe}-${i}`

  return (
    <DialogPrimitive.Root open={ouverte} onOpenChange={onOuverteChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/45 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 top-[10vh] z-50 mx-auto flex max-h-[70vh] max-w-xl flex-col overflow-hidden rounded-xl border bg-card shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] motion-reduce:animate-none"
        >
          <DialogPrimitive.Title className="sr-only">Rechercher ou demander</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={requete}
              onChange={(e) => setRequete(e.target.value)}
              onKeyDown={surTouche}
              placeholder="Aller à une page ou poser une question…"
              role="combobox"
              aria-expanded="true"
              aria-controls={idListe}
              aria-activedescendant={commandes.length ? idOption(indexActif) : undefined}
              aria-autocomplete="list"
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground sm:inline">Échap</kbd>
          </div>
          <ul ref={refListe} id={idListe} role="listbox" aria-label="Commandes" className="overflow-y-auto overscroll-contain p-2">
            {commandes.map((commande, i) => {
              const nouvelleSection = i === 0 || commandes[i - 1].section !== commande.section
              const Icone = commande.icone
              const actif = i === indexActif
              return (
                <li key={commande.id} role="presentation">
                  {nouvelleSection && (
                    <p role="presentation" className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground first:pt-1">
                      {commande.section}
                    </p>
                  )}
                  <div
                    id={idOption(i)}
                    role="option"
                    aria-selected={actif}
                    data-index={i}
                    onMouseMove={() => setIndexActif(i)}
                    onClick={commande.executer}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                      actif ? 'bg-accent text-accent-foreground' : 'text-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-md border',
                        commande.section === 'Demander' ? 'border-primary/30 bg-primary/10 text-primary' : 'bg-card text-muted-foreground',
                      )}
                    >
                      <Icone className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{commande.libelle}</span>
                      {commande.detail && <span className="block truncate text-xs text-muted-foreground">{commande.detail}</span>}
                    </span>
                    {actif && <CornerDownLeft className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden />}
                  </div>
                </li>
              )
            })}
            {!commandes.length && (
              <li role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">
                Aucune page ne correspond.
              </li>
            )}
          </ul>
          <p className="hidden items-center gap-4 border-t bg-muted/50 px-4 py-2 text-xs text-muted-foreground sm:flex">
            <span><kbd className="font-mono">↑ ↓</kbd> parcourir</span>
            <span><kbd className="font-mono">Entrée</kbd> valider</span>
            <span className="ms-auto">Tapez une question pour l’envoyer à l’assistant</span>
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
