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
 *
 * Garde-fous (lot B, R2 / R10 / R14) :
 * - une référence d'incident (`genererReference`) par appel, portée par TOUTES les réponses
 *   d'erreur (`details.reference`) et par chaque ligne de journal `[datagenius] chat` ;
 * - plafond de coût journalier par utilisateur (429 `quota_epuise`), vérifié avant le verrou ;
 * - verrou du tour (verrou.ts) : un tour à la fois par conversation, deux au plus par
 *   utilisateur (409 `tour_en_cours`), pris après les contrôles gratuits et AVANT toute
 *   écriture ou appel au fournisseur, libéré en fin de tour, sur erreur et sur annulation ;
 * - idempotence de l'envoi par l'id du message client (409 `message_deja_recu`) ;
 * - modèle de secours après épuisement des reprises sur indisponibilité (reprise.ts).
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
  estViolationUnicite,
  lireConversationProprietaire,
  lireHistorique,
  lirePiecesJointesProprietaire,
  messageNonVide,
  partiesAPersister,
  rattacherPiecesJointes,
  supprimerConversationVide,
  supprimerMessageAssistant,
  trouverMessageParIdClient,
  type LigneUsage,
  type PieceJointeChat,
  type UsageDeTour,
} from './persistance'
import { construirePromptSysteme, messagesSysteme } from './prompt-systeme'
import { verifierQuotaJournalier } from './quota'
import { genererReference } from './reference'
import { avecReprise, modeleAccepteEffort } from './reprise'
import { genererTitre, titreDeRepli } from './titre'
import { additionnerUsages, normaliserUsage, type UsageComplet } from './usage'
import {
  TOURS_SIMULTANES_MAX,
  compterToursEnCours,
  echeanceVerrou,
  libererVerrou,
  prendreVerrouTour,
  verifierLimiteUtilisateur,
  type VerrouTour,
} from './verrou'

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

/** Champs d'une ligne de journal du chat : identifiants et codes, jamais de contenu ni de secret. */
interface IdentiteJournal {
  reference: string
  conversationId?: string | null
  userId: string
}

type ChampsJournal = IdentiteJournal & { code: string; [champ: string]: unknown }

function journaliserChat(champs: ChampsJournal): void {
  console.error('[datagenius] chat', champs)
}

/**
 * Erreur du flux ou d'un outil : la cause réelle (code, statut, type du fournisseur, message
 * tronqué et sans secret) va au journal serveur avec la référence ; le client ne reçoit que
 * le code.
 */
function formaterErreurFluxJournalisee(champs: IdentiteJournal): (error: unknown) => string {
  return (error: unknown) => {
    journaliserChat({
      ...champs,
      code: classerErreur(error).code,
      evenement: 'erreur_flux',
      cause: decrireErreurPourJournal(error),
    })
    // Suffixe de référence : le client retrouve le code par `medic_assist_erreur:<code>` et affiche la référence.
    return `${formaterErreurFlux(error)} ${champs.reference}`
  }
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
  if (fournisseur !== 'anthropic' || !profond || !modeleAccepteEffort(modele)) return undefined
  return { anthropic: { effort: EFFORT_PROFOND } }
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

/** Modèle effectivement appelé pour une étape (principal ou secours après bascule). */
interface ModeleUtilise {
  fournisseur: Fournisseur
  modeleId: string
}

interface EtatTour {
  debut: number
  etapes: number
  usageEtapes: UsageComplet[]
  /** Modèle réellement utilisé par chaque étape terminée (même index que `usageEtapes`). */
  modelesEtapes: ModeleUtilise[]
  /** Bascule survenue dans l'étape en cours, pas encore terminée. */
  basculeEtape: ModeleUtilise | null
  usageTotal?: UsageComplet
  raisonFin?: string
  erreur?: CodeErreurChat
  interrompu: boolean
  texte: string
  dureeMs?: number
  usagesAnnexes: Omit<LigneUsage, 'userId' | 'conversationId' | 'messageId'>[]
}

/** Modèle de secours prêt à l'emploi (clé disponible). */
interface SecoursFlux {
  modele: LanguageModel
  fournisseur: Fournisseur
  modeleId: string
}

/**
 * Modèle de secours de la configuration, construit avec `creerModele`. Ignoré sans erreur si
 * absent, identique au modèle principal ou sans clé (le chat garde alors le seul principal).
 */
function construireSecours(
  config: ConfigEffective,
  fournisseur: Fournisseur,
  modeleId: string
): SecoursFlux | null {
  const secours = config.modeleSecours
  if (!secours) return null
  if (secours.fournisseur === fournisseur && secours.modele === modeleId) return null
  try {
    return {
      modele: creerModele(secours.fournisseur, secours.modele),
      fournisseur: secours.fournisseur,
      modeleId: secours.modele,
    }
  } catch {
    return null
  }
}

/**
 * Exécute un tour de chat. Renvoie soit une erreur HTTP (rien n'est écrit en base avant les
 * contrôles), soit la réponse en flux (SSE du SDK v7).
 *
 * Ordre : validation du corps -> configuration -> conversation (propriétaire) -> pièces
 * jointes -> quota journalier -> VERROU -> historique, régénération, idempotence -> écritures
 * -> flux. Tant que le flux n'est pas lancé, toute sortie (erreur renvoyée ou exception)
 * libère le verrou ; ensuite, c'est la fin du flux (`onEnd`) qui le libère.
 */
export async function executerChat(entree: EntreeChat): Promise<ResultatChat> {
  const { contexte } = entree
  const { userId } = contexte
  // Une référence par appel, générée d'abord pour que la 400 de validation la porte aussi.
  const reference = genererReference()
  let conversationIdJournal: string | null = null

  /** Erreur HTTP journalisée ; `details.reference` est toujours présent. */
  const echec = (
    statut: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
    journal: Record<string, unknown> = {}
  ): ResultatChat => {
    journaliserChat({
      reference,
      conversationId: conversationIdJournal,
      userId,
      code,
      statut,
      ...journal,
    })
    return erreur(statut, code, message, { reference, ...details })
  }

  const analyse = CorpsRequeteChatSchema.safeParse(entree.corps)
  if (!analyse.success) {
    return echec(400, 'validation', 'Invalid request', { ...analyse.error.flatten() })
  }
  const corps: CorpsRequeteChat = analyse.data
  const declencheur = corps.trigger ?? 'submit-message'
  const profond = corps.modeProfond === true
  const mode: ModeLangage = profond ? 'profond' : 'standard'
  conversationIdJournal = corps.conversationId ?? null

  let verrou: VerrouTour | null = null
  let fluxLance = false
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
        return echec(503, 'fournisseur_non_configure', 'AI provider not configured')
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
      return echec(404, 'not_found', 'Conversation not found')
    }

    // 3. Pièces jointes de l'utilisateur.
    const idsPieces = corps.piecesJointesIds ?? []
    let piecesJointes: PieceJointeChat[] = []
    if (idsPieces.length > 0) {
      const lues = await lirePiecesJointesProprietaire(userId, idsPieces)
      if (!lues) return echec(404, 'not_found', 'Attachment not found')
      piecesJointes = lues
    }

    // 4. Plafond de coût journalier (régénération comprise), avant le verrou.
    const quota = await verifierQuotaJournalier(userId, config.plafondCoutJournalierUsd)
    if (!quota.autorise) {
      return echec(
        429,
        'quota_epuise',
        'Daily AI cost limit reached',
        { reinitialisationA: quota.reinitialisationA.toISOString(), plafondUsd: quota.plafondUsd },
        { consommeUsd: quota.consommeUsd }
      )
    }

    // 5. Verrou du tour. Conversation existante : pris maintenant. Nouvelle conversation : le
    //    verrou est posé à sa création (étape 8) ; on refuse dès ici si l'utilisateur a déjà
    //    atteint sa limite de tours simultanés, pour ne pas créer de conversation inutile.
    if (conversation) {
      const prise = await prendreVerrouTour(userId, conversation.id, new Date())
      if (!prise.pris) {
        return echec(409, 'tour_en_cours', 'A turn is already running', {}, { raison: prise.raison })
      }
      verrou = prise.verrou
    } else if ((await compterToursEnCours(userId, new Date())) >= TOURS_SIMULTANES_MAX) {
      return echec(409, 'tour_en_cours', 'A turn is already running', {}, {
        raison: 'limite_utilisateur',
      })
    }

    // 6. Historique relu en base (sous verrou) ; régénération contrôlée ; idempotence.
    let historique = conversation ? await lireHistorique(userId, conversation.id) : []
    let idARegenerer: string | null = null
    let contexteEcran: ContexteEcran | undefined = corps.contexteEcran
    let messageUtilisateur: MessageMedicAssist | null = null
    const idClient = declencheur === 'submit-message' ? corps.message?.id : undefined

    if (declencheur === 'regenerate-message') {
      const dernier = historique[historique.length - 1]
      if (!dernier || dernier.id !== corps.messageId) {
        const existe = historique.some(m => m.id === corps.messageId && m.role === 'assistant')
        return existe
          ? echec(409, 'conflict', 'Only the last answer can be regenerated')
          : echec(404, 'not_found', 'Message not found')
      }
      if (dernier.role !== 'assistant') return echec(404, 'not_found', 'Message not found')
      historique = historique.slice(0, -1)
      const derniereQuestion = [...historique].reverse().find(m => m.role === 'user')
      if (!derniereQuestion) return echec(409, 'conflict', 'Nothing to regenerate')
      idARegenerer = dernier.id
      const reliquat = reliquatUtilisateur(derniereQuestion)
      if (piecesJointes.length === 0) piecesJointes = reliquat.piecesJointes
      contexteEcran = contexteEcran ?? reliquat.contexte
    } else {
      // Idempotence : un message déjà reçu (même id client) n'est jamais réinséré. Suivi
      // d'une réponse : 409. Dernier message sans réponse (échec précédent, « Réessayer ») :
      // le tour est relancé sur le message enregistré, tel qu'il a été enregistré.
      const existant =
        conversation && idClient
          ? await trouverMessageParIdClient(userId, conversation.id, idClient)
          : null
      if (existant) {
        const dernier = historique[historique.length - 1]
        if (!dernier || dernier.id !== existant.id || dernier.role !== 'user') {
          return echec(409, 'message_deja_recu', 'Message already received')
        }
        const reliquat = reliquatUtilisateur(dernier)
        piecesJointes = reliquat.piecesJointes
        contexteEcran = reliquat.contexte
      } else {
        const parts = (corps.message?.parts ?? []).map(p => ({
          type: 'text' as const,
          text: p.text,
        }))
        messageUtilisateur = {
          id: genererIdMessage(),
          role: 'user',
          parts,
          metadata: {
            creeA: new Date().toISOString(),
            ...(piecesJointes.length > 0
              ? { piecesJointesIds: piecesJointes.map(p => p.id) }
              : {}),
          },
        }
        historique = [...historique, messageUtilisateur]
      }
    }

    // 7. Validation (avant réduction : la réduction compacte les entrées d'outils, qui ne
    //    passeraient plus leur schéma), réduction, puis conversion pour le modèle.
    const outilsValidation = creerOutilsReels(contexte)
    const valides = await validerHistorique(historique, outilsValidation)
    const reduit = reduireHistorique(valides as unknown as MessageUi[]).messages
    const messagesModele = await convertToModelMessages(reduit as unknown as MessageMedicAssist[], {
      tools: outilsValidation,
      ignoreIncompleteToolCalls: true,
    })

    // 8. Écritures : conversation créée côté serveur (verrou posé à la création), message
    //    utilisateur ou suppression.
    let conversationCreee = false
    if (!conversation) {
      const maintenant = new Date()
      const jusqua = echeanceVerrou(maintenant)
      conversation = await creerConversationChat(userId, jusqua)
      conversationCreee = true
      conversationIdJournal = conversation.id
      verrou = { userId, conversationId: conversation.id, jusqua }
      const limite = await verifierLimiteUtilisateur(verrou, maintenant)
      if (!limite.pris) {
        // Course rare (prise simultanée) : la conversation vide créée ici est retirée.
        verrou = null
        await supprimerConversationVide(userId, conversation.id)
        return echec(409, 'tour_en_cours', 'A turn is already running', {}, {
          raison: limite.raison,
        })
      }
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
      try {
        await enregistrerMessageUtilisateur(
          userId,
          conversationId,
          {
            id: messageUtilisateur.id,
            parts: messageUtilisateur.parts,
            ...(idClient ? { idClient } : {}),
          },
          {
            conversationId,
            creeA: new Date().toISOString(),
            piecesJointesIds: piecesJointes.map(p => p.id),
            piecesJointes,
            ...(contexteEcran ? { contexte: contexteEcran } : {}),
          }
        )
      } catch (e) {
        // Course d'insertion du même id client (contrainte unique) : déjà reçu.
        if (estViolationUnicite(e)) {
          return echec(409, 'message_deja_recu', 'Message already received')
        }
        throw e
      }
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

    // 9. Prompt système (statique en cache, dynamique ensuite).
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
      secours: construireSecours(config, fournisseur, modeleId),
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
      reference,
      verrou,
    })
    fluxLance = true
    return { type: 'flux', reponse, conversationId, conversationCreee }
  } catch (e) {
    return echec(500, 'internal', 'Internal error', {}, { erreur: nomErreur(e) })
  } finally {
    // Avant le flux, toute sortie libère le verrou ; après, c'est la fin du flux.
    if (!fluxLance) await libererVerrou(verrou)
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
  /** Modèle de secours (R14), null si aucun. */
  secours: SecoursFlux | null
  /** Référence d'incident de l'appel (journal). */
  reference: string
  /** Verrou du tour, libéré à la fin du flux (onEnd). */
  verrou: VerrouTour | null
}

/**
 * Lignes d'usage du tour. Sans bascule : une ligne, au modèle principal, sur l'usage total
 * (comportement historique). Après une bascule : UNE LIGNE PAR MODÈLE réellement utilisé,
 * chacune au tarif de son modèle (`calculerCoutUsd` sur la somme de ses étapes) ; la première
 * (le principal s'il a servi) porte la durée et le code d'erreur du tour, les suivantes une
 * durée nulle (la durée du tour n'est pas comptée deux fois).
 */
function lignesUsageDuTour(
  etat: EtatTour,
  principal: ModeleUtilise,
  mode: ModeLangage,
  usageTotal: UsageComplet,
  dureeMs: number,
  erreurTour: string | null
): { usage: UsageDeTour; usagesModeles: UsageDeTour[]; coutConnu: boolean } {
  const cle = (m: ModeleUtilise) => `${m.fournisseur}/${m.modeleId}`
  const autreModele = etat.modelesEtapes.some(m => cle(m) !== cle(principal))
  if (!autreModele) {
    const cout = calculerCoutUsd(principal.fournisseur, principal.modeleId, usageTotal)
    return {
      usage: {
        fournisseur: principal.fournisseur,
        modele: principal.modeleId,
        mode,
        usage: usageTotal,
        coutUsd: cout ?? 0,
        dureeMs,
        erreur: erreurTour,
      },
      usagesModeles: [],
      coutConnu: cout !== null,
    }
  }

  const groupes = new Map<string, { modele: ModeleUtilise; usages: UsageComplet[] }>()
  etat.modelesEtapes.forEach((m, i) => {
    const groupe = groupes.get(cle(m)) ?? { modele: m, usages: [] }
    groupe.usages.push(etat.usageEtapes[i])
    groupes.set(cle(m), groupe)
  })
  const ordonnes = [...groupes.values()].sort(
    (a, b) => Number(cle(b.modele) === cle(principal)) - Number(cle(a.modele) === cle(principal))
  )
  let coutConnu = true
  const lignes: UsageDeTour[] = ordonnes.map((g, i) => {
    const usage = additionnerUsages(g.usages)
    const cout = calculerCoutUsd(g.modele.fournisseur, g.modele.modeleId, usage)
    if (cout === null) coutConnu = false
    return {
      fournisseur: g.modele.fournisseur,
      modele: g.modele.modeleId,
      mode,
      usage,
      coutUsd: cout ?? 0,
      dureeMs: i === 0 ? dureeMs : 0,
      erreur: i === 0 ? erreurTour : null,
    }
  })
  return { usage: lignes[0], usagesModeles: lignes.slice(1), coutConnu }
}

function lancerFlux(p: ParametresFlux): Response {
  const { contexte, config, conversationId } = p
  const fournisseur = config.fournisseur
  const principal: ModeleUtilise = { fournisseur, modeleId: p.modeleId }
  const idReponse = genererIdMessage()
  const etat: EtatTour = {
    debut: Date.now(),
    etapes: 0,
    usageEtapes: [],
    modelesEtapes: [],
    basculeEtape: null,
    interrompu: false,
    texte: '',
    usagesAnnexes: [],
  }
  const champsJournal = {
    reference: p.reference,
    conversationId,
    userId: contexte.userId,
  }
  const formaterErreur = formaterErreurFluxJournalisee(champsJournal)
  /** Modèle de la dernière étape terminée (celui qui a produit la réponse). */
  const modeleFinal = (): ModeleUtilise => etat.modelesEtapes.at(-1) ?? principal

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
    const final = modeleFinal()
    const bascule =
      final.fournisseur !== principal.fournisseur || final.modeleId !== principal.modeleId
    return {
      dureeMs: duree(),
      etapes: etat.etapes,
      ...(etat.raisonFin ? { raisonFin: etat.raisonFin } : {}),
      // Après une bascule, le modèle annoncé au début est corrigé par celui qui a répondu.
      ...(bascule ? { fournisseur: final.fournisseur, modele: final.modeleId } : {}),
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
    onError: formaterErreur,
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
      // Après épuisement des reprises sur indisponibilité, l'étape est rejouée une fois avec le
      // modèle de secours ; le modèle réellement utilisé est noté pour l'usage et le tarif.
      const reprise = avecReprise(p.modele, {
        signal: p.signal,
        journal: { reference: p.reference, conversationId },
        ...(p.secours
          ? {
              secours: {
                ...p.secours,
                surBascule: info => {
                  etat.basculeEtape = { fournisseur: info.fournisseur, modeleId: info.modeleId }
                },
              },
            }
          : {}),
      })
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
        // journalisée une fois, décrite sans secret, par `formaterErreurFluxJournalisee`
        // (avec la référence de l'appel).
        onError: () => {},
      })

      const morceaux = toUIMessageStream<typeof outils, MessageMedicAssist>({
        stream: resultat.stream,
        tools: outils,
        sendStart: false,
        onError: formaterErreur,
        messageMetadata: ({ part }) => {
          switch (part.type) {
            case 'finish-step':
              etat.etapes += 1
              etat.usageEtapes.push(normaliserUsage(part.usage))
              etat.modelesEtapes.push(etat.basculeEtape ?? principal)
              etat.basculeEtape = null
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
      const interrompu = isAborted || isCancelled === true || etat.interrompu
      const codeTour = etat.erreur ?? (interrompu ? 'annule' : null)
      try {
        const parts = partiesAPersister(responseMessage?.parts ?? [])
        const usage = usageFinal()
        const { usage: ligneUsage, usagesModeles, coutConnu } = lignesUsageDuTour(
          etat,
          principal,
          p.mode,
          usage,
          duree(),
          codeTour
        )
        const coutTotal = [ligneUsage, ...usagesModeles].reduce((t, l) => t + l.coutUsd, 0)
        const final = modeleFinal()
        const raisonFin =
          etat.raisonFin ?? (interrompu ? 'interrupted' : etat.erreur ? 'error' : undefined)
        const metadonnees: MetadonneesMessage = {
          ...metaDebut,
          // Modèle qui a réellement produit la réponse (secours après une bascule).
          fournisseur: final.fournisseur,
          modele: final.modeleId,
          usage,
          ...(coutConnu ? { coutUsd: coutTotal } : {}),
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
          usage: ligneUsage,
          usagesModeles,
          usagesAnnexes: etat.usagesAnnexes,
        })
        if (p.idARegenerer && remplacementPropre && fin.messageEnregistre) {
          const supprime = await supprimerMessageAssistant(
            contexte.userId,
            conversationId,
            p.idARegenerer
          )
          if (!supprime) {
            journaliserChat({
              ...champsJournal,
              code: 'interne',
              evenement: 'ancienne_reponse_non_supprimee',
            })
          }
        }
      } catch (e) {
        journaliserChat({
          ...champsJournal,
          code: 'interne',
          evenement: 'fin_de_tour_non_enregistree',
          erreur: nomErreur(e),
        })
      } finally {
        // Libéré APRÈS les dernières écritures du tour (réponse, usage, ancienne réponse).
        await libererVerrou(p.verrou)
        const ligne = {
          ...champsJournal,
          code: codeTour ?? 'ok',
          evenement: 'fin_de_tour',
          etapes: etat.etapes,
          dureeMs: duree(),
          modele: `${modeleFinal().fournisseur}/${modeleFinal().modeleId}`,
        }
        // Un tour réussi ou arrêté par l'utilisateur n'est pas une erreur : niveau info.
        if (codeTour && codeTour !== 'annule') journaliserChat(ligne)
        else console.info('[datagenius] chat', ligne)
      }
    },
  })

  return createUIMessageStreamResponse({
    stream: flux,
    headers: ENTETES_FLUX,
    // `consumeStream` lit une copie du flux côté serveur : la fin du tour (onEnd, persistance,
    // libération du verrou) ne dépend pas de la lecture par le client, et un client lent ou
    // parti ne bloque pas la production sur un flux non lu. Il NE PROLONGE PAS le tour après
    // une déconnexion : `abortSignal` (signal de la requête) interrompt alors `streamText` ;
    // la réponse partielle est persistée avec `interrompu: true` (raison `interrupted`) et
    // l'usage déjà consommé est compté (code `annule`). Voir onEnd.
    consumeSseStream: consumeStream,
  })
}
