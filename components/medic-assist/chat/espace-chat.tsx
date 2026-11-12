'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { PanelLeft, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useContexteEcranMedicAssist,
  type DemandeMedicAssist,
} from '@/lib/medic-assist/client/contexte-ecran'
import { ecrireListeRepliee, lireListeRepliee } from '@/lib/medic-assist/client/largeur-panneau'
import { REQUETE_LG, useMediaQuery } from '@/lib/medic-assist/client/use-media-query'
import { peutUtiliserMedicAssist } from '@/lib/medic-assist/contrats/droits'
import { cn } from '@/lib/utils'
import { ConversationChat } from './conversation-chat'
import { GabaritPleinEcran } from './gabarit-plein-ecran'
import { ListeConversations } from './liste-conversations'

const CHEMIN = '/medic-assist'

function urlConversation(id: string): string {
  return `${CHEMIN}?c=${encodeURIComponent(id)}`
}

/** Une instance de conversation : la `cle` remonte le chat, `idActif` suit la creation locale. */
interface Instance {
  cle: number
  /** Conversation chargee au montage (null = nouvelle). */
  idInitial: string | null
  /** Conversation courante : `idInitial`, puis l'id cree a l'envoi du premier message. */
  idActif: string | null
}

/**
 * Tiroir de la liste des conversations sous 1024 px : superposition, Echap et
 * clic sur le fond pour fermer, focus dedans a l'ouverture.
 */
function TiroirConversations({
  onFermer,
  children,
}: {
  onFermer: () => void
  children: ReactNode
}) {
  const t = useTranslations('medicAssist')
  const refPanneau = useRef<HTMLDivElement>(null)
  useEffect(() => {
    refPanneau.current?.focus({ preventScroll: true })
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onFermer()
      }
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [onFermer])
  return (
    <div className="fixed inset-x-0 bottom-0 top-14 z-40 flex">
      <div
        ref={refPanneau}
        role="dialog"
        aria-modal="true"
        aria-label={t('espace.listeConversations')}
        tabIndex={-1}
        className="relative z-10 flex h-full w-[min(20rem,85vw)] flex-col border-e bg-background focus-visible:outline-none"
      >
        {children}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('espace.fermerListe')}
        onClick={onFermer}
        className="flex-1 bg-foreground/40 motion-reduce:transition-none"
      />
    </div>
  )
}

function EspaceChatAutorise({
  prenom,
  roleName,
  estAdmin,
}: {
  prenom?: string
  roleName?: string
  estAdmin: boolean
}) {
  const t = useTranslations('medicAssist')
  const router = useRouter()
  const parametres = useSearchParams()
  const idUrl = parametres?.get('c') || null
  const lg = useMediaQuery(REQUETE_LG)


  /* ------------------------ Instance de conversation ------------------------ */

  const [instance, setInstance] = useState<Instance>({ cle: 1, idInitial: idUrl, idActif: idUrl })
  const instanceRef = useRef(instance)
  instanceRef.current = instance
  // Id de la conversation creee par nous : l'URL qui le rejoint ne doit rien remonter.
  const idCreeLocalement = useRef<string | null>(null)

  // Navigation reelle (retour du navigateur, lien) : nouvelle instance.
  useEffect(() => {
    const courante = instanceRef.current
    if (idUrl === courante.idActif) return
    if (idUrl !== null && idUrl === idCreeLocalement.current) return
    idCreeLocalement.current = null
    setInstance({ cle: courante.cle + 1, idInitial: idUrl, idActif: idUrl })
  }, [idUrl])

  const conversationCreee = useCallback((id: string) => {
    idCreeLocalement.current = id
    // `cle` et `idInitial` restent inchanges : le chat en cours de flux n'est pas remonte.
    setInstance((courante) => ({ ...courante, idActif: id }))
    // Next 14.2 synchronise useSearchParams avec replaceState, sans navigation.
    window.history.replaceState(null, '', urlConversation(id))
  }, [])

  const [tiroirOuvert, setTiroirOuvert] = useState(false)
  const boutonTiroir = useRef<HTMLButtonElement>(null)
  const fermerTiroir = useCallback(() => {
    setTiroirOuvert(false)
    boutonTiroir.current?.focus()
  }, [])

  const nouvelle = useCallback(() => {
    idCreeLocalement.current = null
    setInstance((courante) => ({ cle: courante.cle + 1, idInitial: null, idActif: null }))
    router.push(CHEMIN)
    setTiroirOuvert(false)
  }, [router])

  const selectionner = useCallback(
    (id: string) => {
      setTiroirOuvert(false)
      if (id === instanceRef.current.idActif) return
      idCreeLocalement.current = null
      setInstance((courante) => ({ cle: courante.cle + 1, idInitial: id, idActif: id }))
      router.push(urlConversation(id))
    },
    [router],
  )

  const supprimee = useCallback(
    (id: string) => {
      // Une autre conversation supprimee ne change ni l'etat ni l'URL.
      if (id !== instanceRef.current.idActif) return
      idCreeLocalement.current = null
      setInstance((courante) => ({ cle: courante.cle + 1, idInitial: null, idActif: null }))
      // replace : l'entree d'historique `?c=<id supprime>` ne doit pas rester atteignable.
      router.replace(CHEMIN)
      setTiroirOuvert(false)
    },
    [router],
  )

  /* ------------------------- Liste repliable (bureau) ------------------------- */

  const [listeRepliee, setListeRepliee] = useState(false)
  useEffect(() => {
    setListeRepliee(lireListeRepliee())
  }, [])
  const basculerListe = useCallback(() => {
    setListeRepliee((courante) => {
      ecrireListeRepliee(!courante)
      return !courante
    })
  }, [])

  // Repasser en mode bureau referme le tiroir.
  useEffect(() => {
    if (lg) setTiroirOuvert(false)
  }, [lg])

  /* ----------------------- Demande deposee par le lanceur ----------------------- */

  const demandeStore = useContexteEcranMedicAssist((etat) => etat.demande)
  const [demande, setDemande] = useState<DemandeMedicAssist | null>(null)
  const demandesVues = useRef<Set<string>>(new Set())
  useEffect(() => {
    const prise = useContexteEcranMedicAssist.getState().consommerDemande()
    if (!prise || demandesVues.current.has(prise.id)) return
    demandesVues.current.add(prise.id)
    setDemande(prise)
  }, [demandeStore])
  const demandeTraitee = useCallback((id: string) => {
    setDemande((courante) => (courante?.id === id ? null : courante))
  }, [])

  /* --------------------------------- Rendu --------------------------------- */

  const liste = (
    <ListeConversations
      conversationIdActive={instance.idActif}
      onSelectionner={selectionner}
      onNouvelle={nouvelle}
      onSupprimee={supprimee}
      onFermer={lg ? undefined : fermerTiroir}
    />
  )

  return (
    <GabaritPleinEcran>
      <div className="flex h-full min-w-0">
        {lg && !listeRepliee ? (
          <aside
            aria-label={t('espace.listeConversations')}
            className="flex w-[280px] shrink-0 flex-col border-e bg-card"
          >
            {liste}
          </aside>
        ) : null}

        <section
          aria-label={t('espace.zoneConversation')}
          className="flex min-w-0 flex-1 flex-col"
        >
          <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
            {lg ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={listeRepliee ? t('espace.afficherListe') : t('espace.replierListe')}
                aria-expanded={!listeRepliee}
                onClick={basculerListe}
                className="cible-tactile"
              >
                <PanelLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                ref={boutonTiroir}
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={tiroirOuvert}
                onClick={() => setTiroirOuvert(true)}
                className="cible-tactile gap-2"
              >
                <PanelLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
                {t('liste.titre')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('espace.nouvelleConversation')}
              title={t('espace.nouvelleConversation')}
              onClick={nouvelle}
              className={cn('cible-tactile', lg && !listeRepliee && 'hidden')}
            >
              <Plus className="size-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <ConversationChat
              key={instance.cle}
              idInitial={instance.idInitial}
              onConversationCreee={conversationCreee}
              onNouvelle={nouvelle}
              demande={demande}
              onDemandeTraitee={demandeTraitee}
              prenom={prenom}
              roleName={roleName}
              estAdmin={estAdmin}
            />
          </div>
        </section>

        {!lg && tiroirOuvert ? <TiroirConversations onFermer={fermerTiroir}>{liste}</TiroirConversations> : null}
      </div>
    </GabaritPleinEcran>
  )
}

/** Page de chat : seconde garde cote client ; la page serveur (page.tsx) fait foi. */
export function EspaceChat() {
  const t = useTranslations('medicAssist')
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return (
      <GabaritPleinEcran>
        <div role="status" className="flex h-full flex-col gap-3 p-6">
          <span className="sr-only">{t('espace.chargement')}</span>
          <Skeleton className="h-9 w-1/3" aria-hidden="true" />
          <Skeleton className="h-24 w-full max-w-[760px]" aria-hidden="true" />
        </div>
      </GabaritPleinEcran>
    )
  }

  const roleName = session?.user?.roleName
  const habilitations = session?.user?.habilitations as readonly string[] | null | undefined
  // Sans scope cote client : le role decide (meme regle que la garde serveur).
  if (!peutUtiliserMedicAssist(roleName, null, habilitations)) {
    return (
      <GabaritPleinEcran>
        <div className="flex h-full items-center justify-center p-6">
          <p role="alert" className="text-sm text-muted-foreground">
            {t('espace.nonDisponible')}
          </p>
        </div>
      </GabaritPleinEcran>
    )
  }

  return (
    <EspaceChatAutorise
      prenom={session?.user?.name ?? undefined}
      roleName={roleName ?? undefined}
      estAdmin={roleName === 'SuperAdmin' || roleName === 'TenantAdmin'}
    />
  )
}
