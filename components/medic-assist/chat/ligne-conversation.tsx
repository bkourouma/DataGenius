'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Pin, PinOff, Trash2, Users } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { ConversationResume } from '@/lib/medic-assist/client/types'
import { estTitreParDefaut } from '@/lib/medic-assist/client/titre-conversation'

export interface PropsLigneConversation {
  conversation: ConversationResume
  active: boolean
  /** Roving tabindex : une seule ligne de la liste est atteignable par Tab. */
  tabbable: boolean
  onSelectionner: (id: string) => void
  onFocusLigne: (id: string) => void
  onRenommer: (id: string, titre: string) => void
  onEpingler: (id: string, epinglee: boolean) => void
  onArchiver: (id: string, archivee: boolean) => void
  onSupprimer: (id: string) => void
}

/** Attribut repere par la navigation clavier de la liste. */
export const ATTRIBUT_LIGNE = 'data-ligne-principale'

export function LigneConversation({
  conversation,
  active,
  tabbable,
  onSelectionner,
  onFocusLigne,
  onRenommer,
  onEpingler,
  onArchiver,
  onSupprimer,
}: PropsLigneConversation) {
  const t = useTranslations('medicAssist')
  const partageeAvecMoi = conversation.partageeAvecMoi === true
  const titreAffiche = estTitreParDefaut(conversation.titre)
    ? t('liste.sansTitre')
    : (conversation.titre?.trim() as string)

  const [enRenommage, setEnRenommage] = useState(false)
  const [brouillon, setBrouillon] = useState('')
  const [confirmation, setConfirmation] = useState(false)
  const champ = useRef<HTMLInputElement>(null)
  const renommageDemande = useRef(false)
  const annule = useRef(false)

  const bouton = useRef<HTMLButtonElement>(null)
  const aRenomme = useRef(false)

  useEffect(() => {
    if (enRenommage) {
      aRenomme.current = true
      // Demande par le menu : le focus est pris a sa fermeture (voir onCloseAutoFocus).
      if (!renommageDemande.current) {
        champ.current?.focus()
        champ.current?.select()
      }
    } else if (aRenomme.current) {
      // Le champ disparait : rendre le focus a la ligne.
      aRenomme.current = false
      bouton.current?.focus()
    }
  }, [enRenommage])

  function demarrerRenommage() {
    if (partageeAvecMoi) return
    annule.current = false
    setBrouillon(estTitreParDefaut(conversation.titre) ? '' : (conversation.titre?.trim() ?? ''))
    setEnRenommage(true)
  }

  function terminerRenommage(valider: boolean) {
    const titre = brouillon.trim()
    annule.current = true
    setEnRenommage(false)
    renommageDemande.current = false
    if (valider && titre && titre !== (conversation.titre?.trim() ?? '')) {
      onRenommer(conversation.id, titre)
    }
  }

  const classeLigne = cn(
    'flex items-stretch border-s-2 rounded-md',
    active ? 'border-primary bg-secondary' : 'border-transparent hover:bg-secondary/60',
  )

  return (
    <li className="group relative">
      <div className={classeLigne}>
        {enRenommage ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1">
            <input
              ref={champ}
              type="text"
              value={brouillon}
              maxLength={200}
              aria-label={t('liste.champRenommer')}
              onChange={(e) => setBrouillon(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (brouillon.trim()) terminerRenommage(true)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  terminerRenommage(false)
                }
              }}
              onBlur={() => {
                if (annule.current) return
                terminerRenommage(!!brouillon.trim())
              }}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-md:min-h-11"
            />
          </div>
        ) : (
          <button
            ref={bouton}
            type="button"
            {...{ [ATTRIBUT_LIGNE]: '' }}
            data-conversation-id={conversation.id}
            tabIndex={tabbable ? 0 : -1}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelectionner(conversation.id)}
            onFocus={() => onFocusLigne(conversation.id)}
            onKeyDown={(e) => {
              if (partageeAvecMoi) return
              if (e.key === 'F2') {
                e.preventDefault()
                demarrerRenommage()
              } else if (e.key === 'Delete') {
                e.preventDefault()
                setConfirmation(true)
              }
            }}
            className="flex min-w-0 flex-1 flex-col justify-center rounded-md px-2 py-1.5 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-md:min-h-11"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {partageeAvecMoi ? (
                <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : conversation.epinglee ? (
                <>
                  <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">{t('liste.epingleeIndication')}</span>
                </>
              ) : null}
              <span dir="auto" className="truncate" title={titreAffiche}>
                {titreAffiche}
              </span>
            </span>
            {partageeAvecMoi ? (
              <span className="truncate text-xs text-muted-foreground">
                {conversation.partageePar
                  ? t('liste.partageePar', { nom: conversation.partageePar })
                  : t('liste.lectureSeule')}
              </span>
            ) : null}
          </button>
        )}

        {partageeAvecMoi ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('liste.menu', { titre: titreAffiche })}
                className={cn(
                  'my-0.5 me-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-secondary hover:text-foreground motion-reduce:transition-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-md:h-11 max-md:w-11',
                  'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100',
                )}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => {
                // Le renommage en place prend le focus une fois le menu referme
                // (sa zone de focus pilote le focus tant qu'il est ouvert).
                if (renommageDemande.current) {
                  e.preventDefault()
                  setTimeout(() => {
                    champ.current?.focus()
                    champ.current?.select()
                  }, 0)
                }
              }}
            >
              <DropdownMenuItem
                onSelect={() => {
                  renommageDemande.current = true
                  demarrerRenommage()
                }}
                className="max-md:min-h-11"
              >
                <Pencil className="me-2 h-4 w-4" aria-hidden="true" />
                {t('liste.renommer')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onEpingler(conversation.id, !conversation.epinglee)}
                className="max-md:min-h-11"
              >
                {conversation.epinglee ? (
                  <PinOff className="me-2 h-4 w-4" aria-hidden="true" />
                ) : (
                  <Pin className="me-2 h-4 w-4" aria-hidden="true" />
                )}
                {conversation.epinglee ? t('liste.desepingler') : t('liste.epingler')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onArchiver(conversation.id, !conversation.archivee)}
                className="max-md:min-h-11"
              >
                {conversation.archivee ? (
                  <ArchiveRestore className="me-2 h-4 w-4" aria-hidden="true" />
                ) : (
                  <Archive className="me-2 h-4 w-4" aria-hidden="true" />
                )}
                {conversation.archivee ? t('liste.desarchiver') : t('liste.archiver')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setConfirmation(true)}
                className="text-destructive focus:text-destructive max-md:min-h-11"
              >
                <Trash2 className="me-2 h-4 w-4" aria-hidden="true" />
                {t('liste.supprimer')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {partageeAvecMoi ? null : (
        <AlertDialog open={confirmation} onOpenChange={setConfirmation}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('liste.confirmerSuppressionTitre')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('liste.confirmerSuppressionDescription', { titre: titreAffiche })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('liste.annuler')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => onSupprimer(conversation.id)}
              >
                {t('liste.supprimer')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  )
}
