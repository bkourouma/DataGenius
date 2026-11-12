'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronRight, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { grouperConversations } from '@/lib/medic-assist/client/groupes-conversations'
import {
  useListeConversations,
  useModifierConversation,
  useSupprimerConversation,
} from '@/lib/medic-assist/client/use-conversations'
import type { ConversationResume } from '@/lib/medic-assist/client/types'
import { cn } from '@/lib/utils'

import { ATTRIBUT_LIGNE, LigneConversation } from './ligne-conversation'

const DELAI_RECHERCHE_MS = 250

export interface PropsListeConversations {
  conversationIdActive: string | null
  onSelectionner: (id: string) => void
  onNouvelle: () => void
  onSupprimee?: (id: string) => void
  /** Present dans le tiroir mobile : affiche le bouton de fermeture. */
  onFermer?: () => void
}

function estChampDeSaisie(cible: EventTarget | null): boolean {
  if (!(cible instanceof HTMLElement)) return false
  if (cible.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName)
}

function Squelettes({ nombre }: { nombre: number }) {
  return (
    <div className="space-y-2 px-1" aria-hidden="true">
      {Array.from({ length: nombre }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  )
}

export function ListeConversations({
  conversationIdActive,
  onSelectionner,
  onNouvelle,
  onSupprimee,
  onFermer,
}: PropsListeConversations) {
  const t = useTranslations('medicAssist')
  const [saisie, setSaisie] = useState('')
  const [terme, setTerme] = useState('')
  const [archiveesOuvertes, setArchiveesOuvertes] = useState(false)
  const [idFocus, setIdFocus] = useState<string | null>(null)
  const racine = useRef<HTMLElement>(null)

  useEffect(() => {
    const minuteur = setTimeout(() => setTerme(saisie.trim()), DELAI_RECHERCHE_MS)
    return () => clearTimeout(minuteur)
  }, [saisie])

  const principale = useListeConversations({ recherche: terme, archivees: false })
  const archivees = useListeConversations({
    recherche: terme,
    archivees: true,
    actif: archiveesOuvertes,
  })
  const modifier = useModifierConversation()
  const supprimer = useSupprimerConversation()

  // Alt+N : nouvelle conversation, hors champ de saisie.
  useEffect(() => {
    function surTouche(e: globalThis.KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyN') return
      if (estChampDeSaisie(e.target)) return
      e.preventDefault()
      onNouvelle()
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [onNouvelle])

  const echec = useCallback(() => toast.error(t('liste.erreurAction')), [t])

  const renommer = useCallback(
    (id: string, titre: string) =>
      modifier.mutate(
        { id, patch: { titre } },
        { onSuccess: () => toast.success(t('liste.toastRenommee')), onError: echec },
      ),
    [modifier, t, echec],
  )
  const epingler = useCallback(
    (id: string, epinglee: boolean) =>
      modifier.mutate(
        { id, patch: { epinglee } },
        {
          onSuccess: () =>
            toast.success(t(epinglee ? 'liste.toastEpinglee' : 'liste.toastDesepinglee')),
          onError: echec,
        },
      ),
    [modifier, t, echec],
  )
  const archiver = useCallback(
    (id: string, archivee: boolean) =>
      modifier.mutate(
        { id, patch: { archivee } },
        {
          onSuccess: () =>
            toast.success(t(archivee ? 'liste.toastArchivee' : 'liste.toastDesarchivee')),
          onError: echec,
        },
      ),
    [modifier, t, echec],
  )
  const supprimerLigne = useCallback(
    (id: string) =>
      supprimer.mutate(id, {
        onSuccess: () => {
          toast.success(t('liste.toastSupprimee'))
          onSupprimee?.(id)
        },
        onError: echec,
      }),
    [supprimer, t, echec, onSupprimee],
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps -- recalcule « maintenant » a chaque rafraichissement
  const maintenant = useMemo(() => new Date(), [principale.dataUpdatedAt])
  const moi = principale.data?.moi
  const groupes = useMemo(() => grouperConversations(moi ?? [], maintenant), [moi, maintenant])
  const partagees = principale.data?.partagees ?? []
  const listeArchivees: ConversationResume[] = (archivees.data?.moi ?? []).filter(
    (c) => c.archivee,
  )

  const sections: { cle: keyof typeof groupes; libelle: string }[] = [
    { cle: 'epinglees', libelle: t('liste.groupes.epinglees') },
    { cle: 'aujourdhui', libelle: t('liste.groupes.aujourdhui') },
    { cle: 'septJours', libelle: t('liste.groupes.septJours') },
    { cle: 'plusAncien', libelle: t('liste.groupes.plusAncien') },
  ]

  const idsVisibles = [
    ...sections.flatMap((s) => groupes[s.cle].map((c) => c.id)),
    ...partagees.map((c) => c.id),
    ...(archiveesOuvertes ? listeArchivees.map((c) => c.id) : []),
  ]
  const idTabbable =
    (idFocus && idsVisibles.includes(idFocus) && idFocus) ||
    (conversationIdActive && idsVisibles.includes(conversationIdActive) && conversationIdActive) ||
    idsVisibles[0] ||
    null

  function surToucheListe(e: KeyboardEvent<HTMLElement>) {
    const cible = e.target as HTMLElement
    if (!cible.hasAttribute(ATTRIBUT_LIGNE)) return
    const lignes = Array.from(
      racine.current?.querySelectorAll<HTMLElement>(`[${ATTRIBUT_LIGNE}]`) ?? [],
    )
    const index = lignes.indexOf(cible)
    let suivant: HTMLElement | undefined
    if (e.key === 'ArrowDown') suivant = lignes[Math.min(index + 1, lignes.length - 1)]
    else if (e.key === 'ArrowUp') suivant = lignes[Math.max(index - 1, 0)]
    else if (e.key === 'Home') suivant = lignes[0]
    else if (e.key === 'End') suivant = lignes[lignes.length - 1]
    else return
    e.preventDefault()
    suivant?.focus()
  }

  function rendreLigne(c: ConversationResume) {
    return (
      <LigneConversation
        key={c.id}
        conversation={c}
        active={c.id === conversationIdActive}
        tabbable={c.id === idTabbable}
        onSelectionner={onSelectionner}
        onFocusLigne={setIdFocus}
        onRenommer={renommer}
        onEpingler={epingler}
        onArchiver={archiver}
        onSupprimer={supprimerLigne}
      />
    )
  }

  const nombreAffiche = idsVisibles.length - (archiveesOuvertes ? listeArchivees.length : 0)
  const chargement = principale.isPending
  const erreur = principale.isError && !principale.data
  const vide = !chargement && !erreur && nombreAffiche === 0

  return (
    <nav
      ref={racine}
      aria-label={t('liste.titre')}
      aria-describedby="liste-conversations-aide"
      className="flex h-full min-h-0 w-full flex-col bg-card"
      onKeyDown={surToucheListe}
    >
      <p id="liste-conversations-aide" className="sr-only">
        {t('liste.aideClavier')}
      </p>

      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <h2 className="text-sm font-semibold">{t('liste.titre')}</h2>
        {onFermer ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="cible-tactile h-8 w-8"
            aria-label={t('espace.fermerListe')}
            onClick={onFermer}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <div className="space-y-2 px-3 pb-2">
        <Button
          type="button"
          className="cible-tactile w-full justify-start gap-2"
          aria-keyshortcuts="Alt+N"
          title={`${t('liste.nouvelle')} (${t('liste.raccourciNouvelle')})`}
          onClick={onNouvelle}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('liste.nouvelle')}
        </Button>

        <div className="relative">
          <Search
            className="pointer-events-none absolute start-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            aria-label={t('liste.recherche')}
            placeholder={t('liste.recherche')}
            className="h-9 w-full rounded-md border border-input bg-card placeholder:text-foreground/70 ps-8 pe-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-md:min-h-11 [&::-webkit-search-cancel-button]:hidden"
          />
          {saisie ? (
            <button
              type="button"
              aria-label={t('liste.effacerRecherche')}
              onClick={() => {
                setSaisie('')
                setTerme('')
              }}
              className="absolute end-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {chargement ? (
          <div role="status" aria-busy="true">
            <span className="sr-only">{t('liste.chargement')}</span>
            <Squelettes nombre={6} />
          </div>
        ) : null}

        {erreur ? (
          <div role="alert" className="space-y-2 px-1 py-2 text-sm">
            <p className="text-destructive">{t('liste.erreurChargement')}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => principale.refetch()}>
              {t('fil.reessayer')}
            </Button>
          </div>
        ) : null}

        {vide ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            {terme ? t('liste.aucunResultat', { terme }) : t('liste.vide')}
          </p>
        ) : null}

        {!chargement && !erreur ? (
          <div className="space-y-3">
            {sections.map(({ cle, libelle }) =>
              groupes[cle].length ? (
                <section key={cle} aria-labelledby={`liste-groupe-${cle}`}>
                  <h3
                    id={`liste-groupe-${cle}`}
                    className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {libelle}
                  </h3>
                  <ul className="space-y-0.5">{groupes[cle].map(rendreLigne)}</ul>
                </section>
              ) : null,
            )}

            {partagees.length ? (
              <section aria-labelledby="liste-groupe-partagees">
                <h3
                  id="liste-groupe-partagees"
                  className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t('liste.groupes.partagees')}
                </h3>
                <ul className="space-y-0.5">{partagees.map(rendreLigne)}</ul>
              </section>
            ) : null}
          </div>
        ) : null}

        <section className="mt-3" aria-labelledby="liste-groupe-archivees">
          <h3 id="liste-groupe-archivees" className="text-xs font-semibold">
            <button
              type="button"
              aria-expanded={archiveesOuvertes}
              aria-controls="liste-archivees"
              title={t(archiveesOuvertes ? 'liste.masquerArchivees' : 'liste.afficherArchivees')}
              onClick={() => setArchiveesOuvertes((ouvert) => !ouvert)}
              className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-start uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-md:min-h-11"
            >
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 transition-transform motion-reduce:transition-none rtl:-scale-x-100',
                  archiveesOuvertes && 'rotate-90 rtl:rotate-90',
                )}
                aria-hidden="true"
              />
              {t('liste.groupes.archivees')}
            </button>
          </h3>
          <div id="liste-archivees" hidden={!archiveesOuvertes}>
            {archiveesOuvertes ? (
              archivees.isPending ? (
                <div role="status" aria-busy="true">
                  <span className="sr-only">{t('liste.chargement')}</span>
                  <Squelettes nombre={2} />
                </div>
              ) : archivees.isError && !archivees.data ? (
                <div role="alert" className="space-y-2 px-1 py-2 text-sm">
                  <p className="text-destructive">{t('liste.erreurChargement')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => archivees.refetch()}
                  >
                    {t('fil.reessayer')}
                  </Button>
                </div>
              ) : (
                <ul className="space-y-0.5">{listeArchivees.map(rendreLigne)}</ul>
              )
            ) : null}
          </div>
        </section>
      </div>
    </nav>
  )
}
