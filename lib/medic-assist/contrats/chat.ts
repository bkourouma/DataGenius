/**
 * Contrat du chat (§4) : corps de POST /api/medic-assist/chat, contexte d'écran,
 * métadonnées et format persisté des messages.
 *
 * DÉCISION lot 0 : le client n'envoie QUE le dernier message (`message`), avec
 * `conversationId` ; l'historique est relu côté serveur depuis la base. C'est le
 * schéma documenté par le SDK v7 (`DefaultChatTransport` +
 * `prepareSendMessagesRequest`, voir NOTES-SDK.md) : il évite de renvoyer tout
 * l'historique à chaque tour (limite de 20 Mo) et empêche le client de réécrire
 * les messages passés, y compris les sorties d'outils.
 */

import type { UIMessage } from 'ai'
import { z } from 'zod'

import { CheminInterneSchema, IdentifiantSchema } from '@/lib/medic-assist/contrats/communs'
import { FOURNISSEURS, LIMITES, MODES, VALEURS_AVIS } from '@/lib/medic-assist/contrats/constantes'
import type { OutilsMedicAssist } from '@/lib/medic-assist/contrats/outils'

// ---------------------------------------------------------------------------
// Contexte d'écran
// ---------------------------------------------------------------------------

/** Taille au plus des filtres d'écran sérialisés, en caractères (choix lot 0). */
const TAILLE_MAX_FILTRES_ECRAN = 10_000

/**
 * Écran d'où l'utilisateur ouvre Medic Assist (bouton de l'en-tête, Ctrl+K). Le
 * contexte est une INDICATION pour le modèle : il ne change jamais le périmètre.
 */
export const ContexteEcranSchema = z.object({
  /** Chemin de la page (ex. /rapports-ventes). */
  chemin: CheminInterneSchema,
  /** Titre de l'écran, dans la langue de l'interface. */
  titre: z.string().max(200).optional(),
  /** Paramètres d'URL de l'écran. */
  parametres: z
    .record(z.string().max(64), z.string().max(500))
    .refine(p => Object.keys(p).length <= 30, { error: 'Au plus 30 paramètres d’écran.' })
    .optional(),
  /** Filtres actifs de l'écran (valeurs brutes, sérialisables en JSON). */
  filtres: z
    .record(z.string().max(64), z.unknown())
    .refine(f => JSON.stringify(f).length <= TAILLE_MAX_FILTRES_ECRAN, {
      error: 'Filtres d’écran trop volumineux.',
    })
    .optional(),
  /** Phrase lisible qui résume l'écran et ses filtres (ex. « Rapports ventes, Sénégal, 2026 »). */
  libelle: z.string().max(300).optional(),
})
export type ContexteEcran = z.infer<typeof ContexteEcranSchema>

// ---------------------------------------------------------------------------
// Corps de la requête de chat
// ---------------------------------------------------------------------------

/** Partie texte d'un message utilisateur. Les fichiers passent par piecesJointesIds. */
export const PartieTexteUtilisateurSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1).max(LIMITES.longueurMaxMessageUtilisateur),
})

/**
 * Message utilisateur, tel que useChat le produit (sous-ensemble de UIMessage) :
 * parties texte seulement. Les autres champs (state, providerMetadata) sont ignorés.
 */
export const MessageUtilisateurSchema = z
  .object({
    id: z.string().min(1).max(100),
    role: z.literal('user'),
    parts: z.array(PartieTexteUtilisateurSchema).min(1).max(20),
    metadata: z.unknown().optional(),
  })
  .refine(
    m => m.parts.reduce((n, p) => n + p.text.length, 0) <= LIMITES.longueurMaxMessageUtilisateur,
    { error: 'Message trop long.' }
  )
export type MessageUtilisateur = z.infer<typeof MessageUtilisateurSchema>

/** Déclencheurs du transport de useChat (champ `trigger`). */
export const DECLENCHEURS_CHAT = ['submit-message', 'regenerate-message'] as const
export type DeclencheurChat = (typeof DECLENCHEURS_CHAT)[number]

export const CorpsRequeteChatSchema = z
  .object({
    /**
     * Conversation existante. Absente : le serveur crée la conversation et annonce
     * son id dans la partie de données `data-conversation` (et dans les métadonnées).
     */
    conversationId: IdentifiantSchema.optional(),
    /** Id du chat côté useChat (informatif ; la conversation fait foi). */
    id: z.string().max(100).optional(),
    /** Dernier message utilisateur ; obligatoire pour submit-message. */
    message: MessageUtilisateurSchema.optional(),
    /** submit-message par défaut ; regenerate-message pour « Régénérer ». */
    trigger: z.enum(DECLENCHEURS_CHAT).optional(),
    /** regenerate-message : id du message assistant à régénérer. */
    messageId: z.string().max(100).optional(),
    /** Interrupteur « Analyse approfondie ». */
    modeProfond: z.boolean().optional(),
    /** Pièces jointes déjà téléversées, rattachées au message. */
    piecesJointesIds: z.array(IdentifiantSchema).max(LIMITES.piecesJointesMaxParMessage).optional(),
    contexteEcran: ContexteEcranSchema.optional(),
  })
  .superRefine((corps, ctx) => {
    const declencheur = corps.trigger ?? 'submit-message'
    if (declencheur === 'submit-message' && !corps.message) {
      ctx.addIssue({ code: 'custom', path: ['message'], message: 'Message manquant.' })
    }
    if (declencheur === 'regenerate-message' && (!corps.conversationId || !corps.messageId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['messageId'],
        message: 'La régénération demande conversationId et messageId.',
      })
    }
  })
export type CorpsRequeteChat = z.infer<typeof CorpsRequeteChatSchema>

// ---------------------------------------------------------------------------
// Messages : métadonnées, parties de données, format persisté
// ---------------------------------------------------------------------------

/** Jetons consommés par une réponse (somme des étapes). */
export const UsageTokensSchema = z.object({
  entree: z.number().int().min(0),
  sortie: z.number().int().min(0),
  /** Jetons d'entrée lus depuis le cache de prompt. */
  cacheLecture: z.number().int().min(0).optional(),
  /** Jetons d'entrée écrits dans le cache de prompt. */
  cacheEcriture: z.number().int().min(0).optional(),
  /** Jetons de raisonnement (inclus dans sortie). */
  raisonnement: z.number().int().min(0).optional(),
})
export type UsageTokens = z.infer<typeof UsageTokensSchema>

/**
 * Métadonnées d'un message (`UIMessage.metadata`), envoyées par le serveur via
 * `messageMetadata` de toUIMessageStreamResponse et persistées avec le message.
 */
export const MetadonneesMessageSchema = z.object({
  conversationId: z.string().optional(),
  creeA: z.string().optional(),
  fournisseur: z.enum(FOURNISSEURS).optional(),
  modele: z.string().optional(),
  mode: z.enum(MODES).optional(),
  usage: UsageTokensSchema.optional(),
  coutUsd: z.number().min(0).optional(),
  dureeMs: z.number().int().min(0).optional(),
  /** Étapes d'outils consommées. */
  etapes: z.number().int().min(0).optional(),
  /** Raison de fin du SDK (stop, length, tool-calls, error...). */
  raisonFin: z.string().optional(),
  /** Vrai si l'utilisateur a arrêté la génération. */
  interrompu: z.boolean().optional(),
  avis: z.enum(VALEURS_AVIS).nullable().optional(),
  piecesJointesIds: z.array(z.string()).optional(),
})
export type MetadonneesMessage = z.infer<typeof MetadonneesMessageSchema>

/**
 * Variante à passer au SDK (`validateUIMessages({ metadataSchema })`,
 * `useChat({ messageMetadataSchema })`) : le SDK valide aussi les messages SANS
 * métadonnées (valeur undefined), que l'objet seul refuserait.
 */
export const MetadonneesUIMessageSchema = MetadonneesMessageSchema.optional()

/**
 * Parties de données propres à Medic Assist (`data-<nom>` dans le flux). Les
 * artefacts, actions et relances passent par les parties d'outils
 * (`tool-creer_artefact`, `tool-proposer_action`...) : pas de doublon ici.
 */
export type PartiesDonneesMedicAssist = {
  /** Annonce l'id (et le titre, quand il est prêt) d'une conversation créée par le chat. */
  conversation: { conversationId: string; titre?: string }
}

/**
 * Schémas des parties de données, pour `validateUIMessages({ dataSchemas })` côté
 * serveur et `useChat({ dataPartSchemas })` côté client.
 */
export const SCHEMAS_PARTIES_DONNEES = {
  conversation: z.object({
    conversationId: z.string().min(1),
    titre: z.string().max(LIMITES.longueurMaxTitre).optional(),
  }),
} as const satisfies { [K in keyof PartiesDonneesMedicAssist]: z.ZodType }

/** Message de Medic Assist, typé pour useChat et pour la persistance. */
export type MessageMedicAssist = UIMessage<
  MetadonneesMessage,
  PartiesDonneesMedicAssist,
  OutilsMedicAssist
>

/** Partie d'un message de Medic Assist. */
export type PartieMessageMedicAssist = MessageMedicAssist['parts'][number]

/** Message tel que l'API de conversation le renvoie (format persisté). */
export interface MessagePersiste {
  id: string
  role: 'user' | 'assistant'
  parts: PartieMessageMedicAssist[]
  metadata?: MetadonneesMessage
  creeA: string
}
