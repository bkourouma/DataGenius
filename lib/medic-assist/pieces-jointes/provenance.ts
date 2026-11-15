/**
 * Libelles de provenance d'une piece jointe, produits dans la langue du contexte
 * (`contexte.locale`). Textes dans messages/<langue>/medicAssistAdmin.json, section
 * `piecesJointes.provenance`. Le serveur ne renvoie ailleurs que des codes d'erreur.
 */

import { getTranslations } from 'next-intl/server'

import type { ContexteExecution } from './dependances'

export type CleProvenance =
  | 'perimetre'
  | 'filtreFeuille'
  | 'filtrePlage'
  | 'regleNonVerifie'
  | 'regleTypesInferes'
  | 'reglePourcentage'
  | 'regleTronque'

/** Traduit une cle de `piecesJointes.provenance` ; `valeurs` alimente les {parametres}. */
export type Traducteur = (cle: CleProvenance, valeurs?: Record<string, string | number>) => string

/** Traducteur de la langue du contexte (next-intl cote serveur). */
export async function traducteurProvenance(
  locale: ContexteExecution['locale']
): Promise<Traducteur> {
  // Le typage fin de next-intl ne survit pas a un fichier de cette taille : signature simple.
  const t = (await getTranslations({
    locale,
    namespace: 'medicAssistAdmin',
  })) as unknown as (cle: string, valeurs?: Record<string, string | number>) => string
  return (cle, valeurs) => t(`piecesJointes.provenance.${cle}`, valeurs)
}
