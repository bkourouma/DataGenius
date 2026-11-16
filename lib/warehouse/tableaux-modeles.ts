import { z } from 'zod'

const identifiant = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)
const seuil = z.string().regex(/^-?\d{1,30}(?:\.\d{1,12})?$/)
const titre = z.string().trim().min(1).max(120)

/** Adresse de webhook : HTTPS, sans identifiant, sans port ni fragment (la protection SSRF complète se fait à l’envoi). */
export const UrlWebhook = z.string().trim().max(2048).refine(valeur => {
  if (!URL.canParse(valeur)) return false
  const url = new URL(valeur)
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && Boolean(url.hostname)
}, 'Le webhook doit être une adresse https:// sans identifiant ni port.')

/** Alerte d’une tuile mesure. Sans destinataires, e-mail ni webhook : notification dans l’application au seul propriétaire. */
const alerte = z.strictObject({
  sens: z.enum(['au_dessus', 'au_dessous']), seuil,
  /** Identifiants d’utilisateurs (lecteurs du tableau) notifiés en plus du propriétaire. */
  destinataires: z.array(z.string().min(1).max(100)).max(30).optional(),
  email: z.boolean().optional(),
  /** Réglable par un TenantAdmin seulement (contrôlé à l’envoi sur le rôle du propriétaire). */
  webhook: UrlWebhook.optional(),
}).refine(a => !a.destinataires || new Set(a.destinataires).size === a.destinataires.length, 'Les destinataires doivent être uniques.')

const tuileMesure = z.strictObject({
  id: z.string().uuid(), type: z.literal('mesure'), jeu: identifiant, mesure: identifiant,
  dimensions: z.array(identifiant).max(3),
  objectif: seuil.optional(),
  alerte: alerte.optional(),
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
export type AlerteTuile = z.infer<typeof alerte>
export type FiltreTableau = { cle: string; valeur: string }
