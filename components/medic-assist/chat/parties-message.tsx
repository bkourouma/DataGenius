'use client'

import { AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  ActionProposeeSchema,
  SCHEMAS_PARAMETRES_ACTION,
  type ActionProposee,
} from '@/lib/medic-assist/contrats/actions'
import { TYPES_ACTION, TYPES_ARTEFACT, type TypeAction, type TypeArtefact } from '@/lib/medic-assist/contrats/constantes'
import { estErreurOutil } from '@/lib/medic-assist/contrats/outils'
import {
  OUTILS,
  type MessageUI,
  type PartieMessage,
  type PartieOutil,
  type StatutChat,
} from '@/lib/medic-assist/client/types'
import { sansTextesDupliques } from '@/lib/medic-assist/client/texte-brut'
import { cn } from '@/lib/utils'
import { EtapeEnCours } from './etape-en-cours'
import { CarteAction, CarteArtefact } from './liens-lots'
import { lireSortiePuce, PuceDonnees } from './puce-donnees'
import { lireQuestions, Relances } from './relances'
import { RenduMarkdown } from './rendu-markdown'

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
}

export function estPartieOutil(partie: PartieMessage): partie is PartieOutil {
  return typeof partie.type === 'string' && partie.type.startsWith('tool-')
}

export function nomOutil(partie: PartieOutil): string {
  return partie.type.slice('tool-'.length)
}

function estTypeAction(valeur: unknown): valeur is TypeAction {
  return typeof valeur === 'string' && (TYPES_ACTION as readonly string[]).includes(valeur)
}

/** Sortie de creer_artefact / modifier_artefact (ArtefactCree), tolerante a un titre absent. */
export function lireSortieArtefact(
  sortie: unknown,
): { artefactId: string; titre: string; type: TypeArtefact } | null {
  if (!estObjet(sortie) || estErreurOutil(sortie)) return null
  const { artefactId, titre, type } = sortie
  if (typeof artefactId !== 'string' || !artefactId) return null
  if (typeof type !== 'string' || !(TYPES_ARTEFACT as readonly string[]).includes(type)) return null
  return { artefactId, titre: typeof titre === 'string' ? titre : '', type: type as TypeArtefact }
}

/**
 * Action a afficher a partir d'une partie `tool-proposer_action`. La sortie reelle est
 * ActionEnregistree { actionId, type, statut, resume } : l'ActionProposee complete est
 * reconstruite avec les parametres de l'entree (deja valides par le SDK cote serveur).
 * Une `output.action` complete et valide est preferee quand elle existe.
 */
export function lireAction(partie: PartieOutil): ActionProposee | null {
  const sortie = partie.output
  if (!estObjet(sortie) || estErreurOutil(sortie)) return null
  const complete = ActionProposeeSchema.safeParse(sortie.action)
  if (complete.success) return complete.data
  if (typeof sortie.actionId !== 'string' || !sortie.actionId) return null
  const entree = estObjet(partie.input) ? partie.input : {}
  const type = estTypeAction(sortie.type) ? sortie.type : estTypeAction(entree.type) ? entree.type : null
  if (!type) return null
  const verif = SCHEMAS_PARAMETRES_ACTION[type].safeParse(entree.parametres)
  // Sortie partielle : on garde les parametres tels quels plutot que de masquer la carte.
  const parametres = verif.success ? verif.data : estObjet(entree.parametres) ? entree.parametres : {}
  return {
    id: sortie.actionId,
    type,
    statut: 'proposee',
    parametres,
    ...(typeof sortie.resume === 'string' && sortie.resume !== '' ? { resume: sortie.resume } : {}),
  } as ActionProposee
}

const FORME_CODE_OUTIL = /^[a-z_]{1,64}$/

/**
 * Erreur d'une etape. Un code d'erreur d'outil traduit (`outils.erreursCodes.<code>`, ex.
 * limite_debit_donnees) s'affiche ; sinon un libelle neutre unique. Aucun texte brut (code de
 * flux, message ecrit pour le modele, detail technique) n'est jamais montre dans le fil : le
 * modele corrige lui-meme ces erreurs et poursuit.
 */
function ErreurOutil({ code }: { code?: string }) {
  const t = useTranslations('medicAssist.outils')
  const cle = code && FORME_CODE_OUTIL.test(code) ? `erreursCodes.${code}` : null
  const traduit = cle && t.has(cle as never) ? t(cle as never) : null
  return (
    <p className="my-2 flex items-start gap-2 text-sm text-muted-foreground" role="status">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <span>{traduit ?? t('erreurOutilSansDetail')}</span>
    </p>
  )
}

interface PropsPartieOutil {
  partie: PartieOutil
  afficherRelances: boolean
  estAdmin: boolean
  artefactActifId?: string | null
  onOuvrirArtefact: (artefactId: string) => void
  onPoserQuestion: (texte: string) => void
  onActionChange?: () => void
}

function PartieOutilRendue({
  partie,
  afficherRelances,
  estAdmin,
  artefactActifId,
  onOuvrirArtefact,
  onPoserQuestion,
  onActionChange,
}: PropsPartieOutil) {
  const nom = nomOutil(partie)

  if (nom === OUTILS.relances) {
    if (!afficherRelances || partie.state === 'output-error' || partie.state === 'input-streaming') return null
    const questions = lireQuestions(partie.input)
    return <Relances questions={questions.length ? questions : lireQuestions(partie.output)} onPoserQuestion={onPoserQuestion} />
  }

  if (partie.state === 'input-streaming' || partie.state === 'input-available') {
    return <EtapeEnCours nom={nom} input={partie.input} />
  }
  if (partie.state === 'output-error') return <ErreurOutil />
  if (partie.state !== 'output-available') return null
  if (estErreurOutil(partie.output)) {
    return <ErreurOutil code={partie.output.erreur.code} />
  }

  switch (nom) {
    case OUTILS.interroger:
    case OUTILS.sql: {
      const sortie = lireSortiePuce(partie.output)
      return sortie ? <PuceDonnees sortie={sortie} estAdmin={estAdmin} /> : null
    }
    case OUTILS.creerArtefact:
    case OUTILS.modifierArtefact: {
      const sortie = lireSortieArtefact(partie.output)
      if (!sortie) return null
      return (
        <div
          className={cn(
            'my-2 rounded-lg',
            artefactActifId === sortie.artefactId && 'ring-1 ring-primary',
          )}
        >
          <CarteArtefact
            artefactId={sortie.artefactId}
            titre={sortie.titre}
            type={sortie.type}
            onOuvrir={onOuvrirArtefact}
          />
        </div>
      )
    }
    case OUTILS.action: {
      const action = lireAction(partie)
      return action ? (
        <div className="my-2">
          <CarteAction action={action} onChange={(): void => onActionChange?.()} />
        </div>
      ) : null
    }
    default:
      return null
  }
}

export function PartiesMessage({
  message,
  estDernierAssistant,
  statut,
  lectureSeule,
  estAdmin,
  artefactActifId,
  onOuvrirArtefact,
  onPoserQuestion,
  onActionChange,
}: {
  message: MessageUI
  estDernierAssistant: boolean
  statut: StatutChat
  lectureSeule?: boolean
  estAdmin: boolean
  artefactActifId?: string | null
  onOuvrirArtefact: (artefactId: string) => void
  onPoserQuestion: (texte: string) => void
  onActionChange?: () => void
}) {
  const afficherRelances = estDernierAssistant && statut === 'ready' && !lectureSeule
  // Les relances (outil proposer_relances) passent toujours en fin de message, sous le texte final.
  const estRelances = (partie: PartieMessage): boolean => estPartieOutil(partie) && nomOutil(partie) === OUTILS.relances
  const ordonnees = [
    ...sansTextesDupliques(message.parts).filter((p) => !estRelances(p)),
    ...message.parts.filter(estRelances),
  ]
  return (
    <>
      {ordonnees.map((partie, index) => {
        if (partie.type === 'text') {
          const texte = (partie as { text?: unknown }).text
          if (typeof texte !== 'string' || texte === '') return null
          return <RenduMarkdown key={`t${index}`} markdown={texte} />
        }
        if (estPartieOutil(partie)) {
          return (
            <PartieOutilRendue
              key={partie.toolCallId ?? `o${index}`}
              partie={partie}
              afficherRelances={afficherRelances}
              estAdmin={estAdmin}
              artefactActifId={artefactActifId}
              onOuvrirArtefact={onOuvrirArtefact}
              onPoserQuestion={onPoserQuestion}
              onActionChange={onActionChange}
            />
          )
        }
        return null
      })}
    </>
  )
}

