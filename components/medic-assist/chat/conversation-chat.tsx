'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { signalerArtefactCree } from '@/components/medic-assist/artefacts/use-artefacts-conversation'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErreurApiMedicAssist, creerConversation } from '@/lib/medic-assist/client/api'
import type { DemandeMedicAssist } from '@/lib/medic-assist/client/contexte-ecran'
import {
  LARGEUR_PANNEAU_DEFAUT,
  LARGEUR_PANNEAU_MIN,
  bornerLargeur,
  ecrireLargeurPanneau,
  largeurMaxPanneau,
  lireLargeurPanneau,
} from '@/lib/medic-assist/client/largeur-panneau'
import {
  OUTILS,
  type ConversationDetail,
  type EnvoiMessage,
  type MessageUI,
  type SortieArtefact,
} from '@/lib/medic-assist/client/types'
import {
  useConversation,
  useInvaliderConversations,
  useMettreAJourTitre,
} from '@/lib/medic-assist/client/use-conversations'
import { useMedicChat } from '@/lib/medic-assist/client/use-medic-chat'
import { REQUETE_XL, useMediaQuery } from '@/lib/medic-assist/client/use-media-query'
import { Accueil } from './accueil'
import { FilMessages } from './fil-messages'
import { PanneauArtefacts } from './liens-lots'
import { PoigneePanneau } from './poignee-panneau'
import { ZoneDepot } from './zone-depot'
import { ZoneSaisie, type ZoneSaisieHandle } from './zone-saisie'

const OUTILS_ARTEFACT: readonly string[] = [
  `tool-${OUTILS.creerArtefact}`,
  `tool-${OUTILS.modifierArtefact}`,
]

interface AppelArtefact {
  toolCallId: string
  artefactId: string | null
}

/** Appels `creer_artefact` / `modifier_artefact` termines, dans l'ordre du fil. */
function appelsArtefacts(messages: MessageUI[]): AppelArtefact[] {
  const appels: AppelArtefact[] = []
  for (const message of messages) {
    for (const partie of message.parts) {
      if (!OUTILS_ARTEFACT.includes(partie.type)) continue
      const outil = partie as { toolCallId?: unknown; state?: unknown; output?: unknown }
      if (outil.state !== 'output-available' || typeof outil.toolCallId !== 'string') continue
      const sortie = outil.output as Partial<SortieArtefact> | undefined
      appels.push({
        toolCallId: outil.toolCallId,
        artefactId: typeof sortie?.artefactId === 'string' ? sortie.artefactId : null,
      })
    }
  }
  return appels
}

export interface PropsConversationChat {
  /** Conversation chargee au montage ; null = nouvelle conversation. Ne change jamais. */
  idInitial: string | null
  /** Appele une fois la conversation creee a l'envoi du premier message. */
  onConversationCreee: (id: string) => void
  onNouvelle: () => void
  demande: DemandeMedicAssist | null
  onDemandeTraitee: (id: string) => void
  prenom?: string
  roleName?: string
  estAdmin: boolean
}

function LienNouvelle({ onNouvelle }: { onNouvelle: () => void }) {
  const t = useTranslations('medicAssist')
  return (
    <a
      href="/assistant"
      onClick={(e) => {
        e.preventDefault()
        onNouvelle()
      }}
      className="cible-tactile inline-flex items-center rounded-md text-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {t('espace.demarrerNouvelle')}
    </a>
  )
}

/**
 * Charge la conversation demandee (si elle existe), puis monte le corps du chat
 * avec ses messages comme etat initial. Pour une nouvelle conversation, le
 * corps est monte tout de suite.
 */
export function ConversationChat(props: PropsConversationChat) {
  const t = useTranslations('medicAssist')
  const requete = useConversation(props.idInitial)

  if (props.idInitial) {
    if (requete.isPending) {
      return (
        <div role="status" className="flex flex-1 flex-col gap-4 p-6" data-testid="chargement">
          <span className="sr-only">{t('espace.chargement')}</span>
          <div aria-hidden="true" className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
            <Skeleton className="h-10 w-2/3 self-end" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-1/2 self-end" />
          </div>
        </div>
      )
    }
    // Une erreur de rafraichissement en arriere-plan ne remplace pas une conversation deja affichee.
    if (requete.isError && !requete.data) {
      const erreur = requete.error
      const statut = erreur instanceof ErreurApiMedicAssist ? erreur.statut : 0
      if (statut === 404 || statut === 403) {
        return (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">{t('espace.introuvable')}</p>
            <LienNouvelle onNouvelle={props.onNouvelle} />
          </div>
        )
      }
      return (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{t('espace.erreurChargement')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void requete.refetch()}>
            {t('fil.reessayer')}
          </Button>
        </div>
      )
    }
  }

  return <CorpsConversation {...props} detail={requete.data ?? null} />
}

interface PropsCorps extends PropsConversationChat {
  detail: ConversationDetail | null
}

function CorpsConversation({
  idInitial,
  detail,
  onConversationCreee,
  onNouvelle,
  demande,
  onDemandeTraitee,
  prenom,
  roleName,
  estAdmin,
}: PropsCorps) {
  const t = useTranslations('medicAssist')
  const invalider = useInvaliderConversations()
  const mettreAJourTitre = useMettreAJourTitre()
  const xl = useMediaQuery(REQUETE_XL)

  const [idConversation, setIdConversation] = useState<string | null>(idInitial)
  const idRef = useRef<string | null>(idInitial)
  const creation = useRef(false)
  const monte = useRef(true)
  const [messagesInitiaux] = useState<MessageUI[]>(() => detail?.messages ?? [])
  const lectureSeule = !!(detail?.lectureSeule || detail?.partageeAvecMoi)

  const chat = useMedicChat({
    conversationId: idConversation,
    messagesInitiaux,
    onTitre: mettreAJourTitre,
    onTermine: () => {
      void invalider()
    },
    // Repli : conversation creee par le serveur (data-conversation / metadonnees).
    onConversationCreee: (id) => {
      if (idRef.current === id) return
      idRef.current = id
      setIdConversation(id)
      onConversationCreee(id)
      void invalider()
    },
  })
  const chatRef = useRef(chat)
  chatRef.current = chat
  const enCours = chat.statut === 'submitted' || chat.statut === 'streaming'

  const saisie = useRef<ZoneSaisieHandle>(null)

  useEffect(() => {
    monte.current = true
    return () => {
      monte.current = false
    }
  }, [])

  /* ------------------------------ Envoi ------------------------------ */

  const envoyer = useCallback(
    async (envoi: EnvoiMessage): Promise<boolean> => {
      if (creation.current) return false
      let id = idRef.current
      if (!id) {
        creation.current = true
        try {
          const creee = await creerConversation()
          if (!monte.current) return false
          id = creee.id
          idRef.current = id
          setIdConversation(id)
          onConversationCreee(id)
          void invalider()
        } catch {
          if (monte.current) toast.error(t('espace.erreurCreation'))
          return false
        } finally {
          creation.current = false
        }
      }
      chatRef.current.envoyer(envoi, id)
      return true
    },
    [invalider, onConversationCreee, t],
  )

  const envoyerSaisie = useCallback(
    (envoi: EnvoiMessage) => {
      void envoyer(envoi).then((ok) => {
        // Creation echouee : on rend le texte a l'utilisateur plutot que de le perdre.
        if (!ok && monte.current) saisie.current?.definirTexte(envoi.texte)
      })
    },
    [envoyer],
  )

  const envoyerTexte = useCallback(
    (texte: string) => {
      void envoyer({ texte, modeProfond: false, piecesJointes: [] })
    },
    [envoyer],
  )

  /* --------------------- Demande deposee par le lanceur --------------------- */

  const demandeTraitee = useRef<string | null>(null)
  useEffect(() => {
    if (!demande || demandeTraitee.current === demande.id) return
    if (enCours) return // attend la fin de la reponse en cours
    demandeTraitee.current = demande.id
    if (lectureSeule) {
      // Conversation partagee : on ouvre une nouvelle conversation, qui prendra la demande.
      onNouvelle()
      return
    }
    onDemandeTraitee(demande.id)
    void envoyer({
      texte: demande.question,
      modeProfond: false,
      piecesJointes: [],
      ...(demande.contexte ? { contexteEcran: demande.contexte } : {}),
    })
  }, [demande, enCours, lectureSeule, envoyer, onNouvelle, onDemandeTraitee])

  /* ------------------------------ Panneau ------------------------------ */

  const [artefactActifId, setArtefactActifId] = useState<string | null>(null)
  // L'historique charge n'ouvre jamais le panneau tout seul.
  const [vus] = useState<Set<string>>(
    () => new Set(appelsArtefacts(messagesInitiaux).map((a) => a.toolCallId)),
  )
  const declencheur = useRef<HTMLElement | null>(null)

  useEffect(() => {
    for (const appel of appelsArtefacts(chat.messages)) {
      if (vus.has(appel.toolCallId)) continue
      vus.add(appel.toolCallId)
      if (appel.artefactId) {
        // Le panneau relit la liste des artefacts, puis s'ouvre sur le nouveau (mode prefere).
        signalerArtefactCree(idConversation ?? undefined)
        declencheur.current = null
        setArtefactActifId(appel.artefactId)
      }
    }
  }, [chat.messages, vus, idConversation])

  const ouvrirArtefact = useCallback((artefactId: string) => {
    const actif = document.activeElement
    declencheur.current = actif instanceof HTMLElement && actif !== document.body ? actif : null
    setArtefactActifId(artefactId)
  }, [])
  const fermerPanneau = useCallback(() => setArtefactActifId(null), [])

  const panneauOuvert = !!artefactActifId && !!idConversation
  const recouvrement = panneauOuvert && !xl

  // Retour du focus a la carte qui a ouvert le panneau (ou a la saisie).
  const etaitOuvert = useRef(false)
  useEffect(() => {
    if (etaitOuvert.current && !panneauOuvert) {
      const cible = declencheur.current
      declencheur.current = null
      if (cible && cible.isConnected) cible.focus()
      else saisie.current?.focus()
    }
    etaitOuvert.current = panneauOuvert
  }, [panneauOuvert])

  // Panneau en recouvrement : focus dedans, Echap pour fermer, fil inerte derriere.
  const refPanneau = useRef<HTMLDivElement>(null)
  const refColonne = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!recouvrement) return
    refPanneau.current?.focus({ preventScroll: true })
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setArtefactActifId(null)
      }
    }
    document.addEventListener('keydown', surTouche)
    const colonne = refColonne.current
    colonne?.setAttribute('inert', '')
    return () => {
      document.removeEventListener('keydown', surTouche)
      colonne?.removeAttribute('inert')
    }
  }, [recouvrement])

  /* ------------------------- Largeur du panneau ------------------------- */

  const racine = useRef<HTMLDivElement>(null)
  const [largeurPref, setLargeurPref] = useState(LARGEUR_PANNEAU_DEFAUT)
  const [largeurZone, setLargeurZone] = useState(0)
  useEffect(() => {
    const memorisee = lireLargeurPanneau()
    if (memorisee) setLargeurPref(memorisee)
  }, [])
  useEffect(() => {
    const el = racine.current
    if (!el) return
    setLargeurZone(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    try {
      const observateur = new ResizeObserver((entrees) => {
        const largeur = entrees[0]?.contentRect.width
        if (largeur) setLargeurZone(largeur)
      })
      observateur.observe(el)
      return () => observateur.disconnect()
    } catch {
      // Observateur indisponible : la largeur mesuree au montage suffit.
      return undefined
    }
  }, [])
  const zone = largeurZone || undefined
  const largeur = bornerLargeur(largeurPref, zone)

  /* ------------------------------- Rendu ------------------------------- */

  const partageePar = detail?.partageePar

  return (
    <div ref={racine} className="relative flex min-h-0 flex-1">
      <div ref={refColonne} className="flex min-w-0 flex-1 flex-col">
        <ZoneDepot
          className="flex min-h-0 flex-1 flex-col"
          desactive={lectureSeule}
          onFichiers={(fichiers) => saisie.current?.ajouterFichiers(fichiers)}
        >
          <FilMessages
            messages={chat.messages}
            statut={chat.statut}
            erreur={chat.erreur}
            arrete={chat.arrete}
            lectureSeule={lectureSeule}
            estAdmin={estAdmin}
            artefactActifId={artefactActifId}
            onReessayer={chat.reessayer}
            onNouvelleConversation={onNouvelle}
            onRegenerer={chat.regenerer}
            onPoserQuestion={envoyerTexte}
            onOuvrirArtefact={ouvrirArtefact}
            accueil={<Accueil prenom={prenom} roleName={roleName} onPoser={envoyerTexte} />}
          />
          {lectureSeule ? (
            <div className="shrink-0 px-4 pb-3 pt-1">
              <div
                role="status"
                className="mx-auto flex w-full max-w-[760px] flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-secondary p-3 text-sm"
              >
                <p className="min-w-0 flex-1">
                  {partageePar
                    ? t('espace.lectureSeule', { nom: partageePar })
                    : t('espace.lectureSeuleSansNom')}
                </p>
                <LienNouvelle onNouvelle={onNouvelle} />
              </div>
            </div>
          ) : (
            <div className="shrink-0 px-4 pb-3 pt-1">
              <div className="mx-auto w-full max-w-[760px]">
                <ZoneSaisie
                  ref={saisie}
                  onEnvoyer={envoyerSaisie}
                  onArreter={chat.arreter}
                  enCours={enCours}
                  conversationVide={chat.messages.length === 0}
                />
              </div>
            </div>
          )}
        </ZoneDepot>
      </div>

      {panneauOuvert && idConversation ? (
        xl ? (
          <>
            <PoigneePanneau
              largeur={largeur}
              min={LARGEUR_PANNEAU_MIN}
              max={largeurMaxPanneau(zone)}
              label={t('espace.redimensionner')}
              onChange={(l) => setLargeurPref(bornerLargeur(l, zone))}
              onValider={(l) => ecrireLargeurPanneau(bornerLargeur(l, zone))}
            />
            <div
              ref={refPanneau}
              role="complementary"
              aria-label={t('espace.panneauArtefacts')}
              style={{ width: largeur }}
              className="min-h-0 shrink-0 overflow-hidden"
            >
              <PanneauArtefacts
                conversationId={idConversation}
                artefactActifId={artefactActifId}
                onFermer={fermerPanneau}
                onSelection={setArtefactActifId}
              />
            </div>
          </>
        ) : (
          <div
            ref={refPanneau}
            role="dialog"
            aria-label={t('espace.panneauArtefacts')}
            tabIndex={-1}
            className="z-40 overflow-hidden bg-background focus-visible:outline-none max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-14 lg:absolute lg:inset-0 lg:z-30"
          >
            <PanneauArtefacts
              conversationId={idConversation}
              artefactActifId={artefactActifId}
              onFermer={fermerPanneau}
              onSelection={setArtefactActifId}
            />
          </div>
        )
      ) : null}
    </div>
  )
}
