/**
 * Briefing d'accueil (§4, §5) : ce qui mérite l'attention à l'ouverture de Medic
 * Assist (visas qui expirent, écarts au budget, mois non saisis, stocks faibles,
 * AMM). Calculé par `calculerBriefing(contexte)` (lot 2), mis en cache
 * LIMITES.dureeCacheBriefingMs par utilisateur, servi par GET /api/medic-assist/briefing.
 */

import { z } from 'zod'

import {
  HorodatageSchema,
  LienInterneSchema,
  PeriodeMoisSchema,
} from '@/lib/medic-assist/contrats/communs'
import { FormatColonneSchema } from '@/lib/medic-assist/contrats/donnees'

export const GRAVITES_BRIEFING = ['critique', 'attention', 'info'] as const
export type GraviteBriefing = (typeof GRAVITES_BRIEFING)[number]

export const CATEGORIES_BRIEFING = ['visas', 'budget', 'saisie', 'stocks', 'amm'] as const
export type CategorieBriefing = (typeof CATEGORIES_BRIEFING)[number]

export const ElementBriefingSchema = z.object({
  gravite: z.enum(GRAVITES_BRIEFING),
  categorie: z.enum(CATEGORIES_BRIEFING),
  /** Titre court, déjà traduit dans la langue du lecteur. */
  titre: z.string().min(1).max(200),
  detail: z.string().max(1_000),
  /** Valeur mise en avant (nombre de visas, taux...), avec son format. */
  valeur: z.number().optional(),
  format: FormatColonneSchema.optional(),
  lien: LienInterneSchema.optional(),
  /** Question prête à poser à l'assistant (bouton « Demander »). */
  question: z.string().max(500).optional(),
})
export type ElementBriefing = z.infer<typeof ElementBriefingSchema>

export const BriefingSchema = z.object({
  calculeA: HorodatageSchema,
  /** Mois de référence : le dernier mois complet. */
  periodeReference: PeriodeMoisSchema,
  /** Éléments classés du plus grave au moins grave. */
  elements: z.array(ElementBriefingSchema),
})
export type Briefing = z.infer<typeof BriefingSchema>
