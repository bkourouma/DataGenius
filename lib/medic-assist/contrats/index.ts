/**
 * Contrats partagés de Medic Assist (§4 de l'architecture) : SEULE source commune
 * des lots 1 à 7. Importer depuis '@/lib/medic-assist/contrats'.
 *
 * Un lot qui a besoin d'un changement de contrat le demande dans son rapport : on
 * ne redéfinit pas un type localement. Les noms exportés sont stables.
 *
 * Chargeable côté client comme côté serveur : aucun import serveur (Prisma, next/*)
 * ici, sinon des types.
 */

export * from '@/lib/medic-assist/contrats/constantes'
export * from '@/lib/medic-assist/contrats/communs'
export * from '@/lib/medic-assist/contrats/contexte'
export * from '@/lib/medic-assist/contrats/donnees'
export * from '@/lib/medic-assist/contrats/artefacts'
export * from '@/lib/medic-assist/contrats/actions'
export * from '@/lib/medic-assist/contrats/briefing'
export * from '@/lib/medic-assist/contrats/outils'
export * from '@/lib/medic-assist/contrats/chat'
export * from '@/lib/medic-assist/contrats/api'
