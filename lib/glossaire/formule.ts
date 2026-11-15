import type { Locale } from '@/i18n/config'
import type { AgregatMesure, DefinitionMesure, EntreeCatalogue } from '@/lib/medic-assist/donnees/catalogue/types'

/**
 * Formule lisible d'un indicateur, construite sans jamais lire l'expression SQL.
 * Le libellé de l'agrégat est traduit par l'interface (clé `agregats`).
 */
export interface Formule {
  agregat: AgregatMesure
  /** Colonne agrégée (numérateur pour un rapport) ; null si elle n'est pas exposée. */
  colonne: string | null
  denominateur?: string
  /** Conditions de filtre propres à l'indicateur, dans la langue demandée. */
  regles: string[]
}

/**
 * Une colonne qui n'appartient pas à la vue autorisée n'est jamais affichée :
 * le registre autorisé retire déjà les colonnes masquées, ceci est une seconde barrière.
 */
export function construireFormule(mesure: DefinitionMesure, locale: Locale, colonnesVisibles?: ReadonlySet<string>): Formule {
  const visible = (nom: string | undefined) => (nom && (!colonnesVisibles || colonnesVisibles.has(nom)) ? nom : null)
  const requises = mesure.colonnesRequises ?? []
  const formule: Formule = {
    agregat: mesure.agregat,
    colonne: visible(requises[0]),
    regles: (mesure.regles ?? []).map(regle => regle[locale]).filter(Boolean),
  }
  if (mesure.agregat === 'rapport') {
    const denominateur = visible(requises[1])
    if (denominateur) formule.denominateur = denominateur
  }
  return formule
}

export function colonnesDe(entree: EntreeCatalogue): ReadonlySet<string> {
  return new Set(entree.vue.colonnes.map(c => c.nom))
}
