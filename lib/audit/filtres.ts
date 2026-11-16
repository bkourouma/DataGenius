/**
 * Lecture tolérante des filtres de la page du journal d'audit et de son export.
 * Une valeur invalide est ignorée : jamais d'exception, jamais d'erreur 400 pour un paramètre mal formé.
 */

import { z } from 'zod'

import { ACTIONS_AUDIT, FAMILLES_AUDIT, type FiltresAudit } from '@/lib/audit/types'

export type ParametresBruts = URLSearchParams | Record<string, string | string[] | undefined>

const PAGE_MAX = 100_000

const jourSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((v) => new Date(`${v}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()))
const texteSchema = z.string().trim().min(1).max(100)
const familleSchema = z.enum(FAMILLES_AUDIT)
const actionSchema = z.enum(ACTIONS_AUDIT)
const pageSchema = z.coerce.number().int().min(1)

function lire(params: ParametresBruts, cle: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(cle) ?? undefined
  const v = params[cle]
  return Array.isArray(v) ? v[0] : v
}

function jour(brut: string | undefined): Date | undefined {
  if (brut === undefined) return undefined
  const lu = jourSchema.safeParse(brut)
  if (!lu.success) return undefined
  // Aller-retour ISO : détecte les dates impossibles (31 février).
  return lu.data.toISOString().slice(0, 10) === brut ? lu.data : undefined
}

function valeur<T>(schema: z.ZodType<T>, brut: string | undefined): T | undefined {
  if (brut === undefined) return undefined
  const lu = schema.safeParse(brut)
  return lu.success ? lu.data : undefined
}

export function analyserFiltres(params: ParametresBruts): { filtres: FiltresAudit; page: number } {
  let depuis = jour(lire(params, 'du'))
  let jusqua = jour(lire(params, 'au'))
  if (depuis && jusqua && depuis.getTime() > jusqua.getTime()) [depuis, jusqua] = [jusqua, depuis]

  const filtres: FiltresAudit = {}
  if (depuis) filtres.depuis = depuis
  if (jusqua) filtres.jusqua = jusqua
  const acteur = valeur(texteSchema, lire(params, 'acteur'))
  if (acteur) filtres.acteur = acteur
  const famille = valeur(familleSchema, lire(params, 'famille'))
  if (famille) filtres.famille = famille
  const action = valeur(actionSchema, lire(params, 'action'))
  if (action) filtres.action = action
  const cible = valeur(texteSchema, lire(params, 'cible'))
  if (cible) filtres.cible = cible

  const page = valeur(pageSchema, lire(params, 'page'))
  return { filtres, page: Math.min(page ?? 1, PAGE_MAX) }
}
