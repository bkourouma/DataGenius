/**
 * Actions proposées par l'assistant (§4). L'outil proposer_action ne fait
 * qu'ENREGISTRER une proposition (statut « proposee ») : l'exécution n'a lieu qu'au
 * clic de l'utilisateur sur la carte de confirmation, après une nouvelle
 * vérification des droits (POST /api/medic-assist/actions/[id]/confirmer).
 *
 * Les destinataires sont toujours des utilisateurs MedicPro, désignés par leur id
 * (obtenu par rechercher_entites, type « utilisateur ») : jamais d'adresse e-mail
 * libre.
 */

import { z } from 'zod'

import {
  DateCivileSchema,
  IdentifiantSchema,
  LienInterneSchema,
  texteMultiligneSurSchema,
  texteSurSchema,
} from '@/lib/medic-assist/contrats/communs'
import {
  FORMATS_ENVOI,
  FREQUENCES_RAPPORT,
  LIMITES,
  STATUTS_ACTION,
  TYPES_ACTION,
  type TypeAction,
} from '@/lib/medic-assist/contrats/constantes'

const destinatairesSchema = () =>
  z
    .array(IdentifiantSchema)
    .min(1)
    .max(LIMITES.destinatairesMax)
    .describe(
      'Ids des utilisateurs MedicPro destinataires (rechercher_entites, type utilisateur). Jamais d’adresse e-mail.'
    )

const formatsSchema = () =>
  z
    .array(z.enum(FORMATS_ENVOI))
    .min(1)
    .max(FORMATS_ENVOI.length)
    .describe('Formats joints : xlsx (Excel à la charte), pdf, csv.')

const artefactIdSchema = (role: string) =>
  IdentifiantSchema.describe(`Id de l’artefact ${role} (renvoyé par creer_artefact).`)

export const PRIORITES_TACHE = ['basse', 'normale', 'haute'] as const
export type PrioriteTache = (typeof PRIORITES_TACHE)[number]

/** Entités auxquelles une tâche peut être rattachée (Task.relatedEntityType). */
export const TYPES_LIEN_TACHE = [
  'artefact',
  'conversation',
  'produit',
  'pays',
  'grossiste',
  'agence',
  'procedure_amm',
  'visa',
] as const
export type TypeLienTache = (typeof TYPES_LIEN_TACHE)[number]

export const ParametresCreerTacheSchema = z
  .strictObject({
    titre: texteSurSchema(LIMITES.longueurMaxTitre, 'Intitulé de la tâche, à l’infinitif.'),
    description: texteMultiligneSurSchema(
      LIMITES.longueurMaxMessageAction,
      'Détail de la tâche (contexte, attendu).'
    ).optional(),
    assigneA: IdentifiantSchema.describe(
      'Id de l’utilisateur MedicPro chargé de la tâche (rechercher_entites, type utilisateur).'
    ),
    echeance: DateCivileSchema.optional().describe('Échéance, AAAA-MM-JJ.'),
    priorite: z
      .enum(PRIORITES_TACHE)
      .optional()
      .describe('basse, normale ou haute ; absente : normale.'),
    lien: z
      .strictObject({
        type: z
          .enum(TYPES_LIEN_TACHE)
          .describe(
            'Nature de l’élément lié : artefact, conversation, produit, pays, grossiste, agence, procedure_amm ou visa.'
          ),
        id: IdentifiantSchema.describe('Id de l’élément lié (renvoyé par un outil).'),
      })
      .optional()
      .describe('Élément concerné par la tâche (artefact, produit, pays, procédure AMM...).'),
  })
  .describe('Paramètres de creer_tache.')
export type ParametresCreerTache = z.infer<typeof ParametresCreerTacheSchema>

export const ParametresEnvoyerEmailSchema = z
  .strictObject({
    artefactId: artefactIdSchema('à envoyer'),
    destinataires: destinatairesSchema(),
    formats: formatsSchema(),
    message: texteMultiligneSurSchema(
      LIMITES.longueurMaxMessageAction,
      'Mot d’accompagnement facultatif.'
    ).optional(),
  })
  .describe(
    'Paramètres de envoyer_email : l’artefact, recalculé dans le périmètre de chaque destinataire, part en pièce jointe.'
  )
export type ParametresEnvoyerEmail = z.infer<typeof ParametresEnvoyerEmailSchema>

export const ParametresNotifierSchema = z
  .strictObject({
    destinataires: destinatairesSchema(),
    message: texteMultiligneSurSchema(1_000, 'Texte de la notification dans MedicPro.'),
    artefactId: artefactIdSchema('joint à la notification').optional(),
  })
  .describe('Paramètres de notifier : une notification dans la cloche de MedicPro.')
export type ParametresNotifier = z.infer<typeof ParametresNotifierSchema>

export const ParametresProgrammerRapportSchema = z
  .strictObject({
    artefactId: artefactIdSchema('à envoyer à chaque échéance'),
    frequence: z.enum(FREQUENCES_RAPPORT).describe('quotidien, hebdomadaire ou mensuel.'),
    jourSemaine: z
      .number()
      .int()
      .min(1)
      .max(7)
      .optional()
      .describe('Obligatoire en hebdomadaire : 1 = lundi … 7 = dimanche.'),
    jourMois: z
      .number()
      .int()
      .min(1)
      .max(28)
      .optional()
      .describe('Obligatoire en mensuel : jour du mois, de 1 à 28.'),
    heure: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .describe('Heure d’envoi HH:MM, heure du serveur MedicPro (ex. 08:00).'),
    destinataires: destinatairesSchema(),
    formats: formatsSchema(),
  })
  .superRefine((p, ctx) => {
    if (p.frequence === 'hebdomadaire' && p.jourSemaine === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['jourSemaine'],
        message: 'jourSemaine est obligatoire pour un rapport hebdomadaire.',
      })
    }
    if (p.frequence === 'mensuel' && p.jourMois === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['jourMois'],
        message: 'jourMois est obligatoire pour un rapport mensuel.',
      })
    }
  })
  .describe(
    'Paramètres de programmer_rapport : l’artefact est recalculé et envoyé par e-mail à chaque échéance.'
  )
export type ParametresProgrammerRapport = z.infer<typeof ParametresProgrammerRapportSchema>

/** Schéma des paramètres de chaque type d'action. */
export const SCHEMAS_PARAMETRES_ACTION = {
  creer_tache: ParametresCreerTacheSchema,
  envoyer_email: ParametresEnvoyerEmailSchema,
  notifier: ParametresNotifierSchema,
  programmer_rapport: ParametresProgrammerRapportSchema,
} as const satisfies Record<TypeAction, z.ZodType>

export interface ParametresParTypeAction {
  creer_tache: ParametresCreerTache
  envoyer_email: ParametresEnvoyerEmail
  notifier: ParametresNotifier
  programmer_rapport: ParametresProgrammerRapport
}
export type ParametresAction = ParametresParTypeAction[TypeAction]

export const TypeActionSchema = z
  .enum(TYPES_ACTION)
  .describe(
    'creer_tache (tâche assignée à un collègue), envoyer_email (artefact par e-mail), notifier (notification dans MedicPro), programmer_rapport (envoi récurrent d’un artefact).'
  )

/** Résultat d'une action exécutée (ou en échec). */
export const ResultatActionSchema = z.object({
  /** Message lisible pour l'utilisateur (ex. « Tâche créée pour Awa Diallo »). */
  message: z.string().max(500),
  /** Enregistrement créé : Task, RapportProgramme, Notification... */
  entiteId: z.string().optional(),
  lien: LienInterneSchema.optional(),
  /** Cause d'un échec, lisible. */
  erreur: z.string().max(500).optional(),
})
export type ResultatAction = z.infer<typeof ResultatActionSchema>

const champsAction = {
  id: z.string().min(1),
  statut: z.enum(STATUTS_ACTION),
  /**
   * Résumé lisible, construit par le serveur avec les NOMS (jamais les ids). Absent quand
   * aucun résumé détaillé n'est stocké : l'interface affiche alors le libellé traduit du type.
   */
  resume: z.string().max(1_000).optional(),
  resultat: ResultatActionSchema.optional(),
  conversationId: z.string().optional(),
  creeA: z.string().optional(),
  traiteeA: z.string().optional(),
}

export const ActionProposeeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('creer_tache'),
    parametres: ParametresCreerTacheSchema,
    ...champsAction,
  }),
  z.object({
    type: z.literal('envoyer_email'),
    parametres: ParametresEnvoyerEmailSchema,
    ...champsAction,
  }),
  z.object({ type: z.literal('notifier'), parametres: ParametresNotifierSchema, ...champsAction }),
  z.object({
    type: z.literal('programmer_rapport'),
    parametres: ParametresProgrammerRapportSchema,
    ...champsAction,
  }),
])
/** Action proposée, telle que l'API la renvoie et que CarteAction l'affiche. */
export type ActionProposee = z.infer<typeof ActionProposeeSchema>

/**
 * Correspondance avec les valeurs de la table Task (en anglais, défaut « normal »
 * et « pending » en base). Recommandation du lot 0 pour le lot 5.
 */
export const PRIORITE_TACHE_EN_BASE: Record<PrioriteTache, string> = {
  basse: 'low',
  normale: 'normal',
  haute: 'high',
}
