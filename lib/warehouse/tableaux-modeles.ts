import { z } from 'zod'

const identifiant = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)
const seuil = z.string().regex(/^-?\d{1,30}(?:\.\d{1,12})?$/)
const titre = z.string().trim().min(1).max(120)

const tuileMesure = z.strictObject({
  id: z.string().uuid(), type: z.literal('mesure'), jeu: identifiant, mesure: identifiant,
  dimensions: z.array(identifiant).max(3),
  objectif: seuil.optional(),
  alerte: z.strictObject({ sens: z.enum(['au_dessus', 'au_dessous']), seuil }).optional(),
})
const tuileArtefact = z.strictObject({
  id: z.string().uuid(), type: z.literal('artefact'), artefact: z.string().min(1).max(100),
})

export const DefinitionTableauSchema = z.strictObject({
  titre, tuiles: z.array(z.discriminatedUnion('type', [tuileMesure, tuileArtefact])).max(12),
  lecteurs: z.array(z.string().min(1).max(100)).max(30),
}).refine(d => new Set(d.tuiles.map(t => t.id)).size === d.tuiles.length &&
  new Set(d.lecteurs).size === d.lecteurs.length, 'Les tuiles et les lecteurs doivent être uniques.')

export type DefinitionTableau = z.infer<typeof DefinitionTableauSchema>
export type TuileMesure = z.infer<typeof tuileMesure>
export type FiltreTableau = { cle: string; valeur: string }
