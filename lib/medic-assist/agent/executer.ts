/**
 * Cœur d'exécution du chat de Medic Assist (lot 1) : validation du corps, conversation,
 * pièces jointes, historique relu en base, boucle d'agent en flux (SDK IA v7), titre et
 * persistance de fin de tour.
 *
 * La route POST /api/medic-assist/chat reste mince : elle appelle `exigerMedicAssist()`,
 * contrôle la taille, lit le JSON et délègue ici. Cette fonction est testable sans HTTP et
 * réutilisée par l'essai réel (tests/integration/medic-assist/lot1/essai-reel.ts).
 *
 * Règles :
 * - le `userId` et le périmètre viennent du contexte serveur, jamais du client ni du modèle ;
 * - l'historique est relu en base : l'historique client n'est jamais utilisé ;
 * - aucun contenu de message ni détail du fournisseur n'est renvoyé au client (les erreurs du
 *   flux sont des codes `medic_assist_erreur:<code>`) ; le journal serveur ne reçoit que la
 *   cause décrite par `decrireErreurPourJournal` (statut, type, message court, sans secret) ;
 * - la persistance de fin de tour ne bloque jamais la fermeture du flux.
 */

import { restrictionsActives } from '@/lib/auth/data-access'
import {
  consumeStream,
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
  wrapLanguageModel,
  type LanguageModel,
  type SystemModelMessage,
  type UIMessageChunk,
} from 'ai'

import {
  CorpsRequeteChatSchema,
  LIMITES,
  MetadonneesUIMessageSchema,
  SCHEMAS_PARTIES_DONNEES,
  type ContexteEcran,
  type ContexteExecution,
  type CorpsRequeteChat,
  EntreeCreerArtefactSchema,
  estErreurOutil,
  type Fournisseur,
  type MessageMedicAssist,
  type MetadonneesMessage,
  type ModeLangage,
} from '@/lib/medic-assist/contrats'
import {
  ErreurFournisseurAbsent,
  calculerCoutUsd,
  creerModele,
  lireConfigMedicAssist,
  optionsCachePrompt,
  type ConfigEffective,
} from '@/lib/medic-assist/config'
import { resumeCatalogueCompact } from '@/lib/medic-assist/donnees/outils'

import { TITRE_PAR_DEFAUT_CONVERSATION } from './conversations'
import { ErreurSaisieOutilRepetee, creerSuiviSaisiesInvalides } from './saisie-invalide'
import {
  classerErreur,
  decrireErreurPourJournal,
  formaterErreurFlux,
  type CodeErreurChat,
} from './erreurs'
import {
  LONGUEUR_MAX_TEXTE_GARDE,
  collecterMorceau,
  construireSpecTableau,
  creerEtatLivraison,
  evaluerLivraison,
} from './garde-livraison'
import { reduireHistorique, type MessageUi } from './historique'
import { creerOutilsReels } from './outils-adaptateur'
import {
  creerConversationChat,
  enregistrerFinDeTour,
  enregistrerMessageUtilisateur,
  enregistrerTitre,
  lireConversationProprietaire,
  lireHistorique,
  lirePiecesJointesProprietaire,
  messageNonVide,
  partiesAPersister,
  rattacherPiecesJointes,
  supprimerMessageAssistant,
  type LigneUsage,
  type PieceJointeChat,
} from './persistance'
import { construirePromptSysteme, messagesSysteme } from './prompt-systeme'
import { avecReprise } from './reprise'
import { genererTitre, titreDeRepli } from './titre'
import { additionnerUsages, normaliserUsage, type UsageComplet } from './usage'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/**
 * En-têtes du flux : pas de cache ni de transformation par un proxy, pas de mise en tampon
 * (IIS ARR / nginx). Les autres en-têtes SSE sont posés par le SDK.
 */
export const ENTETES_FLUX: Record<string, string> = {
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
}

/**
 * Jetons de sortie au plus par étape, pour Claude seulement (les modèles 5.5 acceptent
 * 128 000 jetons ; la réflexion adaptative compte dans cette borne, d'où une marge large).
 * Chez les autres fournisseurs, la borne du fournisseur s'applique : une valeur trop haute
 * y serait refusée (DeepSeek, par exemple).
 */
export const MAX_JETONS_SORTIE_CLAUDE: Record<'standard' | 'profond', number> = {
  standard: 32_000,
  profond: 64_000,
}

/** Effort de raisonnement de l'analyse approfondie (option `effort` de @ai-sdk/anthropic). */
export const EFFORT_PROFOND = 'high' as const

/** Modèles Claude qui acceptent `effort` (génération 5 et suivantes). */
const MODELES_AVEC_EFFORT = /^claude-(opus|sonnet|haiku|fable)-5/

/** Délai au plus accordé au titre avant la fermeture du flux. */
export const DELAI_TITRE_MS = 3_000

/** Id stable de la partie `data-conversation` : l'écriture du titre remplace la première. */
export const ID_PARTIE_CONVERSATION = 'conversation'

/** Résumé du catalogue quand la couche de données (lot 2) ne répond pas : le chat continue. */
export const RESUME_CATALOGUE_REPLI =
  'Résumé du catalogue indisponible pour le moment : appelle catalogue_donnees pour ' +
  "décrire un jeu (dimensions, mesures, filtres) avant de l'interroger."

/** Texte de réponse gardé en mémoire pour le titre (au-delà, inutile). */
const LONGUEUR_MAX_TEXTE_TITRE = 4_000

const genererIdMessage = createIdGenerator({ prefix: 'msg', size: 24 })

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export interface CorpsErreurChat {
  error: string
  message: string
  details?: unknown
}

export type ResultatChat =
  | { type: 'erreur'; statut: number; corps: CorpsErreurChat }
  | { type: 'flux'; reponse: Response; conversationId: string; conversationCreee: boolean }

export interface EntreeChat {
  /** Contexte de `exigerMedicAssist()` : seule source du userId et du périmètre. */
  contexte: ContexteExecution
  /** Corps JSON déjà lu (non validé). */
  corps: unknown
  /** Signal d'annulation de la requête (arrêt par l'utilisateur, déconnexion). */
  signal?: AbortSignal
}

function erreur(statut: number, error: string, message: string, details?: unknown): ResultatChat {
  return {
    type: 'erreur',
    statut,
    corps: details === undefined ? { error, message } : { error, message, details },
  }
}

/**
 * Erreur du flux ou d'un outil : la cause réelle (code, statut, type du fournisseur, message
 * tronqué et sans secret) va au journal serveur ; le client ne reçoit que le code.
 */
function formaterErreurFluxJournalisee(error: unknown): string {
  console.error('[medic-assist/chat] erreur du flux', decrireErreurPourJournal(error))
  return formaterErreurFlux(error)
}

function nomErreur(e: unknown): string {
  return e instanceof Error ? e.name : typeof e
}

function estFournisseurAbsent(e: unknown): boolean {
  return (
    e instanceof ErreurFournisseurAbsent ||
    (e instanceof Error && e.name === 'ErreurFournisseurAbsent')
  )
}

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------

/** Résumé du catalogue (lot 2) ; repli court s'il lève ou renvoie du vide. */
export async function resumeCatalogueSur(contexte: ContexteExecution): Promise<string> {
  try {
    const resume = await resumeCatalogueCompact(contexte)
    return typeof resume === 'string' && resume.trim() !== '' ? resume : RESUME_CATALOGUE_REPLI
  } catch {
    return RESUME_CATALOGUE_REPLI
  }
}

function texteDuMessage(message: MessageMedicAssist | undefined): string {
  if (!message) return ''
  return message.parts
    .map(p => (p.type === 'text' && typeof p.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
}

function metadonneesBrutes(message: MessageMedicAssist | undefined): Record<string, unknown> {
  const m = message?.metadata as unknown
  return typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : {}
}

/** Pièces jointes et contexte d'écran du dernier message utilisateur (régénération). */
function reliquatUtilisateur(message: MessageMedicAssist | undefined): {
  piecesJointes: PieceJointeChat[]
  contexte?: ContexteEcran
} {
  const meta = metadonneesBrutes(message)
  const piecesJointes = Array.isArray(meta.piecesJointes)
    ? meta.piecesJointes
        .filter(
          (p): p is PieceJointeChat =>
            typeof p === 'object' &&
            p !== null &&
            typeof (p as PieceJointeChat).id === 'string' &&
            typeof (p as PieceJointeChat).nom === 'string'
        )
        .slice(0, LIMITES.piecesJointesMaxParMessage)
    : []
  const contexte =
    typeof meta.contexte === 'object' && meta.contexte !== null
      ? (meta.contexte as ContexteEcran)
      : undefined
  return contexte ? { piecesJointes, contexte } : { piecesJointes }
}

/**
 * Valide l'historique relu en base. Repli prudent : si l'ensemble est invalide, on garde les
 * messages valides un par un et on journalise seulement le NOMBRE de messages écartés.
 */
async function validerHistorique(
  messages: MessageMedicAssist[],
  outils: Record<string, unknown>
): Promise<MessageMedicAssist[]> {
  if (messages.length === 0) return []
  const options = {
    tools: outils as never,
    metadataSchema: MetadonneesUIMessageSchema,
    dataSchemas: SCHEMAS_PARTIES_DONNEES,
  }
  const global = await safeValidateUIMessages<MessageMedicAssist>({ messages, ...options })
  if (global.success) return global.data

  const valides: MessageMedicAssist[] = []
  for (const message of messages) {
    const seul = await safeValidateUIMessages<MessageMedicAssist>({
      messages: [message],
      ...options,
    })
    if (seul.success) valides.push(...seul.data)
  }
  const ecartes = messages.length - valides.length
  console.warn(`[medic-assist/chat] historique : ${ecartes} message(s) invalide(s) ignoré(s)`)
  return valides
}

/** Modèle accepté par `wrapLanguageModel` (objet de spécification V2 à V4). */
type ModeleEnveloppable = Parameters<typeof wrapLanguageModel>[0]['model']

/** Usage brut d'un appel au fournisseur (format LanguageModelV4Usage, lu de façon défensive). */
interface UsageFournisseur {
  inputTokens?: { total?: number; noCache?: number; cacheRead?: number; cacheWrite?: number }
  outputTokens?: { total?: number; reasoning?: number }
}

/** Usage du fournisseur (format LanguageModelV4) vers le format du contrat. */
function usageDuFournisseur(usage: UsageFournisseur | undefined): UsageComplet {
  return normaliserUsage({
    inputTokens: usage?.inputTokens?.total,
    inputTokenDetails: {
      noCacheTokens: usage?.inputTokens?.noCache,
      cacheReadTokens: usage?.inputTokens?.cacheRead,
      cacheWriteTokens: usage?.inputTokens?.cacheWrite,
    },
    outputTokens: usage?.outputTokens?.total,
    outputTokenDetails: { reasoningTokens: usage?.outputTokens?.reasoning },
  })
}

/**
 * Enveloppe un modèle pour relever l'usage de ses appels `generateText` (titre) sans modifier
 * `titre.ts`. Un modèle qui n'est pas un objet V4 est rendu tel quel (usage non relevé).
 */
function avecReleveUsage(modele: LanguageModel, releve: { usage?: UsageComplet }): LanguageModel {
  if (typeof modele !== 'object' || modele === null) return modele
  if ((modele as { specificationVersion?: string }).specificationVersion !== 'v4') return modele
  return wrapLanguageModel({
    model: modele as ModeleEnveloppable,
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        const resultat = await doGenerate()
        releve.usage = additionnerUsages(
          releve.usage,
          usageDuFournisseur(resultat.usage as UsageFournisseur)
        )
        return resultat
      },
    },
  })
}

function optionsFournisseur(
  fournisseur: Fournisseur,
  modele: string,
  profond: boolean
): Record<string, Record<string, string>> | undefined {
  if (fournisseur !== 'anthropic' || !profond || !MODELES_AVEC_EFFORT.test(modele)) return undefined
  return { anthropic: { effort: EFFORT_PROFOND } }
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

interface EtatTour {
  debut: number
  etapes: number
  usageEtapes: UsageComplet[]
  usageTotal?: UsageComplet
  raisonFin?: string
  erreur?: CodeErreurChat
  interrompu: boolean
  texte: string
  dureeMs?: number
  usagesAnnexes: Omit<LigneUsage, 'userId' | 'conversationId' | 'messageId'>[]
}

/**
 * Exécute un tour de chat. Renvoie soit une erreur HTTP (rien n'est écrit en base avant les
 * contrôles), soit la réponse en flux (SSE du SDK v7).
 */
export async function executerChat(entree: EntreeChat): Promise<ResultatChat> {
  const { contexte } = entree
  const { userId } = contexte

  const analyse = CorpsRequeteChatSchema.safeParse(entree.corps)
  if (!analyse.success) {
    return erreur(400, 'validation', 'Invalid request', analyse.error.flatten())
  }
  const corps: CorpsRequeteChat = analyse.data
  const declencheur = corps.trigger ?? 'submit-message'
  const profond = corps.modeProfond === true
  const mode: ModeLangage = profond ? 'profond' : 'standard'

  try {
    // 1. Configuration et modèle : 503 avant toute écriture si aucune clé n'est disponible.
    const config: ConfigEffective = await lireConfigMedicAssist()
    const fournisseur = config.fournisseur
    const modeleId = config.modeles[mode]
    let modele: LanguageModel
    try {
      modele = creerModele(fournisseur, modeleId)
    } catch (e) {
      if (estFournisseurAbsent(e)) {
        return erreur(503, 'fournisseur_non_configure', 'AI provider not configured')
      }
      throw e
    }

    // 2. Conversation existante : propriétaire SEUL (un lecteur par partage n'écrit pas).
    const droits = contexte.scope.donnees
    let conversation = corps.conversationId
      ? await lireConversationProprietaire(userId, corps.conversationId,
        restrictionsActives(droits) && !droits.administrateur ? droits.depuis : undefined)
      : null
    if (corps.conversationId && !conversation) {
      return erreur(404, 'not_found', 'Conversation not found')
    }

    // 3. Pièces jointes de l'utilisateur.
    const idsPieces = corps.piecesJointesIds ?? []
    let piecesJointes: PieceJointeChat[] = []
    if (idsPieces.length > 0) {
      const lues = await lirePiecesJointesProprietaire(userId, idsPieces)
      if (!lues) return erreur(404, 'not_found', 'Attachment not found')
      piecesJointes = lues
    }

    // 4. Historique relu en base ; régénération contrôlée.
    let historique = conversation ? await lireHistorique(userId, conversation.id) : []
    let idARegenerer: string | null = null
    let contexteEcran: ContexteEcran | undefined = corps.contexteEcran
    let messageUtilisateur: MessageMedicAssist | null = null

    if (declencheur === 'regenerate-message') {
      const dernier = historique[historique.length - 1]
      if (!dernier || dernier.id !== corps.messageId) {
        const existe = historique.some(m => m.id === corps.messageId && m.role === 'assistant')
        return existe
          ? erreur(409, 'conflict', 'Only the last answer can be regenerated')
          : erreur(404, 'not_found', 'Message not found')
      }
      if (dernier.role !== 'assistant') return erreur(404, 'not_found', 'Message not found')
      historique = historique.slice(0, -1)
      const derniereQuestion = [...historique].reverse().find(m => m.role === 'user')
      if (!derniereQuestion) return erreur(409, 'conflict', 'Nothing to regenerate')
      idARegenerer = dernier.id
      const reliquat = reliquatUtilisateur(derniereQuestion)
      if (piecesJointes.length === 0) piecesJointes = reliquat.piecesJointes
      contexteEcran = contexteEcran ?? reliquat.contexte
    } else {
      const parts = (corps.message?.parts ?? []).map(p => ({ type: 'text' as const, text: p.text }))
      messageUtilisateur = {
        id: genererIdMessage(),
        role: 'user',
        parts,
        metadata: {
          creeA: new Date().toISOString(),
          ...(piecesJointes.length > 0 ? { piecesJointesIds: piecesJointes.map(p => p.id) } : {}),
        },
      }
      historique = [...historique, messageUtilisateur]
    }

    // 5. Validation (avant réduction : la réduction compacte les entrées d'outils, qui ne
    //    passeraient plus leur schéma), réduction, puis conversion pour le modèle.
    const outilsValidation = creerOutilsReels(contexte)
    const valides = await validerHistorique(historique, outilsValidation)
    const reduit = reduireHistorique(valides as unknown as MessageUi[]).messages
    const messagesModele = await convertToModelMessages(reduit as unknown as MessageMedicAssist[], {
      tools: outilsValidation,
      ignoreIncompleteToolCalls: true,
    })

    // 6. Écritures : conversation créée côté serveur, message utilisateur ou suppression.
    let conversationCreee = false
    if (!conversation) {
      conversation = await creerConversationChat(userId)
      conversationCreee = true
    }
    const conversationId = conversation.id
    const titreInitial = conversation.titre
    const contexteTour: ContexteExecution & { conversationId: string } = {
      ...contexte,
      conversationId,
    }

    // Régénération : l'ancienne réponse n'est supprimée qu'à la fin du tour (voir onEnd), une
    // fois la nouvelle enregistrée ; un échec du fournisseur la laisse donc en place.
    if (!idARegenerer && messageUtilisateur) {
      await enregistrerMessageUtilisateur(
        userId,
        conversationId,
        { id: messageUtilisateur.id, parts: messageUtilisateur.parts },
        {
          conversationId,
          creeA: new Date().toISOString(),
          piecesJointesIds: piecesJointes.map(p => p.id),
          piecesJointes,
          ...(contexteEcran ? { contexte: contexteEcran } : {}),
        }
      )
      if (piecesJointes.length > 0) {
        await rattacherPiecesJointes(
          userId,
          piecesJointes.map(p => p.id),
          conversationId
        )
      }
    }

    const question = texteDuMessage(
      messageUtilisateur ?? [...historique].reverse().find(m => m.role === 'user')
    )

    // 7. Prompt système (statique en cache, dynamique ensuite).
    const prompt = construirePromptSysteme({
      contexte: contexteTour,
      modeProfond: profond,
      resumeCatalogue: await resumeCatalogueSur(contexteTour),
      ...(contexteEcran ? { contexteEcran } : {}),
      ...(piecesJointes.length > 0 ? { piecesJointes } : {}),
    })
    const instructions = messagesSysteme(
      prompt,
      optionsCachePrompt(fournisseur)
    ) as unknown as SystemModelMessage[]

    const reponse = lancerFlux({
      contexte: contexteTour,
      config,
      modele,
      modeleId,
      mode,
      profond,
      instructions,
      messagesModele,
      originaux: valides,
      conversationId,
      conversationCreee,
      titreParDefaut: titreInitial === TITRE_PAR_DEFAUT_CONVERSATION,
      question,
      idARegenerer,
      signal: entree.signal,
    })
    return { type: 'flux', reponse, conversationId, conversationCreee }
  } catch (e) {
    console.error('[medic-assist/chat] erreur interne', nomErreur(e))
    return erreur(500, 'internal', 'Internal error')
  }
}

interface ParametresFlux {
  contexte: ContexteExecution & { conversationId: string }
  config: ConfigEffective
  modele: LanguageModel
  modeleId: string
  mode: ModeLangage
  profond: boolean
  instructions: SystemModelMessage[]
  messagesModele: Awaited<ReturnType<typeof convertToModelMessages>>
  originaux: MessageMedicAssist[]
  conversationId: string
  conversationCreee: boolean
  titreParDefaut: boolean
  question: string
  /** Réponse de l'assistant à remplacer (régénération) ; supprimée seulement si la nouvelle est enregistrée. */
  idARegenerer: string | null
  signal?: AbortSignal
}

function lancerFlux(p: ParametresFlux): Response {
  const { contexte, config, conversationId } = p
  const fournisseur = config.fournisseur
  const idReponse = genererIdMessage()
  const etat: EtatTour = {
    debut: Date.now(),
    etapes: 0,
    usageEtapes: [],
    interrompu: false,
    texte: '',
    usagesAnnexes: [],
  }

  const metaDebut: MetadonneesMessage = {
    conversationId,
    creeA: new Date(etat.debut).toISOString(),
    fournisseur,
    modele: p.modeleId,
    mode: p.mode,
  }

  const usageFinal = (): UsageComplet => etat.usageTotal ?? additionnerUsages(etat.usageEtapes)
  const duree = (): number => etat.dureeMs ?? Math.max(0, Date.now() - etat.debut)

  // Le coût et le détail des jetons restent côté serveur (table d'usage, administration) :
  // ils ne sont pas envoyés au navigateur.
  const metadonneesFin = (): MetadonneesMessage => {
    return {
      dureeMs: duree(),
      etapes: etat.etapes,
      ...(etat.raisonFin ? { raisonFin: etat.raisonFin } : {}),
    }
  }

  // Saisies d'outil invalides du tour : rendues au modèle comme résultat d'outil (saisie-invalide.ts),
  // comptées ici ; à la borne le tour s'arrête et échoue (erreur classée, message masqué).
  const suiviSaisies = creerSuiviSaisiesInvalides()
  const outils = creerOutilsReels(contexte, { suiviSaisies })

  async function produireTitre(): Promise<string | undefined> {
    const repli = titreDeRepli(p.question)
    const releve: { usage?: UsageComplet } = {}
    const controleur = new AbortController()
    let minuteur: ReturnType<typeof setTimeout> | undefined
    const debutTitre = Date.now()
    try {
      let modeleRapide: LanguageModel | null = null
      try {
        modeleRapide = avecReleveUsage(creerModele(fournisseur, config.modeles.rapide), releve)
      } catch {
        modeleRapide = null
      }
      const delai = new Promise<string>(resoudre => {
        minuteur = setTimeout(() => {
          controleur.abort()
          resoudre(repli)
        }, DELAI_TITRE_MS)
      })
      const titre = modeleRapide
        ? await Promise.race([
            genererTitre({
              modele: modeleRapide,
              question: p.question,
              reponse: etat.texte,
              locale: contexte.locale,
              signal: controleur.signal,
            }),
            delai,
          ])
        : repli
      if (releve.usage) {
        const cout = calculerCoutUsd(fournisseur, config.modeles.rapide, releve.usage)
        etat.usagesAnnexes.push({
          fournisseur,
          modele: config.modeles.rapide,
          mode: 'rapide',
          usage: releve.usage,
          coutUsd: cout ?? 0,
          dureeMs: Date.now() - debutTitre,
        })
      }
      const net = titre.trim().slice(0, LIMITES.longueurMaxTitre)
      if (!net) return undefined
      return (await enregistrerTitre(contexte.userId, conversationId, net)) ? net : undefined
    } catch (e) {
      console.error('[medic-assist/chat] titre non enregistré', nomErreur(e))
      return undefined
    } finally {
      if (minuteur) clearTimeout(minuteur)
    }
  }

  const flux = createUIMessageStream<MessageMedicAssist>({
    originalMessages: p.originaux,
    onError: formaterErreurFluxJournalisee,
    execute: async ({ writer }) => {
      writer.write({ type: 'start', messageId: idReponse, messageMetadata: metaDebut })
      if (p.conversationCreee) {
        writer.write({
          type: 'data-conversation',
          id: ID_PARTIE_CONVERSATION,
          data: { conversationId },
        })
      }

      // Reprise bornée des erreurs réessayables du fournisseur, étape par étape, tant que rien
      // de l'étape n'a été diffusé ; elle remplace les reprises par défaut du SDK.
      const reprise = avecReprise(p.modele, { signal: p.signal })
      const resultat = streamText({
        model: reprise.modele,
        ...(reprise.maxRetriesSdk !== undefined ? { maxRetries: reprise.maxRetriesSdk } : {}),
        instructions: p.instructions,
        messages: p.messagesModele,
        tools: outils,
        stopWhen: [
          isStepCount(p.profond ? LIMITES.etapesMaxProfond : LIMITES.etapesMaxStandard),
          () => suiviSaisies.atteinte(),
        ],
        ...(p.signal ? { abortSignal: p.signal } : {}),
        ...(fournisseur === 'anthropic'
          ? { maxOutputTokens: MAX_JETONS_SORTIE_CLAUDE[p.profond ? 'profond' : 'standard'] }
          : {}),
        ...(optionsFournisseur(fournisseur, p.modeleId, p.profond)
          ? { providerOptions: optionsFournisseur(fournisseur, p.modeleId, p.profond) }
          : {}),
        // Le SDK journalise l'erreur brute par défaut (avec la requête) : coupé. L'erreur est
        // journalisée une fois, décrite sans secret, par `formaterErreurFluxJournalisee`.
        onError: () => {},
      })

      const morceaux = toUIMessageStream<typeof outils, MessageMedicAssist>({
        stream: resultat.stream,
        tools: outils,
        sendStart: false,
        onError: formaterErreurFluxJournalisee,
        messageMetadata: ({ part }) => {
          switch (part.type) {
            case 'finish-step':
              etat.etapes += 1
              etat.usageEtapes.push(normaliserUsage(part.usage))
              return undefined
            case 'error':
              etat.erreur ??= classerErreur(part.error).code
              return undefined
            case 'abort':
              etat.interrompu = true
              return undefined
            case 'finish':
              etat.usageTotal = normaliserUsage(part.totalUsage)
              etat.raisonFin = part.finishReason
              etat.dureeMs = Math.max(0, Date.now() - etat.debut)
              return metadonneesFin()
            default:
              return undefined
          }
        },
      })

      // Garde-fou de livraison : suit les jeux interrogés, les artefacts livrés et le texte.
      const livraison = creerEtatLivraison()
      let texteComplet = ''

      const livrerTableauManquant = async (): Promise<void> => {
        try {
          const jeu = evaluerLivraison({
            jeux: livraison.jeux,
            artefactLivre: livraison.artefactLivre,
            texte: texteComplet,
          })
          if (!jeu) return
          const spec = construireSpecTableau(jeu, contexte.locale)
          const analyse = spec ? EntreeCreerArtefactSchema.safeParse(spec) : null
          if (!analyse?.success) {
            console.warn(
              '[medic-assist/chat] garde de livraison : artefact non créé (spec_invalide)'
            )
            return
          }
          const toolCallId = `garde_${genererIdMessage()}`
          const sortie: unknown = await outils.creer_artefact.execute!(analyse.data, {
            toolCallId,
            messages: [],
            context: undefined,
            ...(p.signal ? { abortSignal: p.signal } : {}),
          })
          if (estErreurOutil(sortie)) {
            console.warn(
              `[medic-assist/chat] garde de livraison : artefact non créé (${sortie.erreur.code})`
            )
            return
          }
          writer.write({
            type: 'tool-input-available',
            toolCallId,
            toolName: 'creer_artefact',
            input: analyse.data,
          } as never)
          writer.write({ type: 'tool-output-available', toolCallId, output: sortie } as never)
          console.info(
            `[medic-assist/chat] garde de livraison : tableau créé (${jeu.nbLignes} lignes)`
          )
        } catch (e) {
          console.warn(
            `[medic-assist/chat] garde de livraison : artefact non créé (${nomErreur(e)})`
          )
        }
      }

      // Lecture à la main : la partie `finish` est retenue pour annoncer le titre avant elle.
      const lecteur = morceaux.getReader()
      let fin: UIMessageChunk | undefined
      try {
        for (;;) {
          const { done, value } = await lecteur.read()
          if (done) break
          if (value.type === 'finish') {
            fin = value as UIMessageChunk
            continue
          }
          if (value.type === 'abort') etat.interrompu = true
          if (value.type === 'text-delta' && etat.texte.length < LONGUEUR_MAX_TEXTE_TITRE) {
            etat.texte += value.delta
          }
          if (value.type === 'text-delta' && texteComplet.length < LONGUEUR_MAX_TEXTE_GARDE) {
            texteComplet += value.delta
          }
          collecterMorceau(livraison, value)
          writer.write(value)
        }
      } catch (e) {
        etat.erreur ??= classerErreur(e).code
        throw e
      } finally {
        lecteur.releaseLock()
      }

      // Saisie d'outil invalide répétée : le moteur s'est arrêté à la borne, le tour échoue.
      if (suiviSaisies.atteinte() && !etat.erreur && !etat.interrompu) {
        const echec = new ErreurSaisieOutilRepetee(suiviSaisies.nombre)
        etat.erreur = classerErreur(echec).code
        throw echec
      }

      // Garde-fou : détail d'un jeu interrogé non livré -> tableau créé par le serveur.
      if (!etat.erreur && !etat.interrompu && !(p.signal?.aborted ?? false)) {
        await livrerTableauManquant()
      }

      const titreAGenerer =
        p.titreParDefaut &&
        !etat.interrompu &&
        !etat.erreur &&
        etat.texte.trim() !== '' &&
        !(p.signal?.aborted ?? false)
      if (titreAGenerer) {
        const titre = await produireTitre()
        if (titre) {
          writer.write({
            type: 'data-conversation',
            id: ID_PARTIE_CONVERSATION,
            data: { conversationId, titre },
          })
        }
      }

      if (fin) writer.write(fin as never)
    },
    onEnd: async ({ responseMessage, isAborted, isCancelled }) => {
      try {
        const interrompu = isAborted || isCancelled === true || etat.interrompu
        const parts = partiesAPersister(responseMessage?.parts ?? [])
        const usage = usageFinal()
        const cout = calculerCoutUsd(fournisseur, p.modeleId, usage)
        const raisonFin =
          etat.raisonFin ?? (interrompu ? 'interrupted' : etat.erreur ? 'error' : undefined)
        const metadonnees: MetadonneesMessage = {
          ...metaDebut,
          usage,
          ...(cout !== null ? { coutUsd: cout } : {}),
          dureeMs: duree(),
          etapes: etat.etapes,
          ...(raisonFin ? { raisonFin } : {}),
          ...(interrompu ? { interrompu: true } : {}),
        }
        // Régénération interrompue ou en erreur : on ne persiste pas la réponse partielle, pour
        // ne pas laisser deux réponses de l'assistant à la suite de la même question.
        const remplacementPropre = !interrompu && !etat.erreur
        const persisterMessage = messageNonVide(parts) && (!p.idARegenerer || remplacementPropre)
        const fin = await enregistrerFinDeTour({
          userId: contexte.userId,
          conversationId,
          ...(persisterMessage
            ? { message: { id: responseMessage?.id || idReponse, parts, metadonnees } }
            : {}),
          usage: {
            fournisseur,
            modele: p.modeleId,
            mode: p.mode,
            usage,
            coutUsd: cout ?? 0,
            dureeMs: duree(),
            erreur: etat.erreur ?? (interrompu ? 'annule' : null),
          },
          usagesAnnexes: etat.usagesAnnexes,
        })
        if (p.idARegenerer && remplacementPropre && fin.messageEnregistre) {
          const supprime = await supprimerMessageAssistant(
            contexte.userId,
            conversationId,
            p.idARegenerer
          )
          if (!supprime) {
            console.error('[medic-assist/chat] ancienne réponse non supprimée après régénération')
          }
        }
      } catch (e) {
        console.error('[medic-assist/chat] fin de tour non enregistrée', nomErreur(e))
      }
    },
  })

  return createUIMessageStreamResponse({
    stream: flux,
    headers: ENTETES_FLUX,
    // Copie du flux consommée côté serveur : le tour va au bout (et se persiste) même si le
    // client se déconnecte sans annuler la requête.
    consumeSseStream: consumeStream,
  })
}
