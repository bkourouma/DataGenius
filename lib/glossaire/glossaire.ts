import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { registreAutorise } from '@/lib/medic-assist/donnees/catalogue/autorisation'
import type { Registre } from '@/lib/medic-assist/donnees/catalogue/types'
import { colonnesDe, construireFormule, type Formule } from './formule'
import { normaliser } from './normaliser'

export interface ComplementGlossaire {
  jeu: string
  indicateur: string
  definition: string
  synonymes: string[]
}

export interface EntreeGlossaire {
  jeu: { cle: string; libelle: string }
  indicateur: { cle: string; libelle: string }
  /** Complément administrateur s'il existe, sinon définition du catalogue. */
  definition: string
  /** Texte du complément seul (vide s'il n'y en a pas), pour préremplir le formulaire administrateur. */
  complement: string
  formule: Formule
  unite: string | null
  synonymes: string[]
  /** Identifiant d'ancre stable : `jeu-indicateur`. */
  ancre: string
}

export interface DependancesGlossaire {
  /** Registre BRUT : les droits du contexte lui sont appliqués ici. */
  registre?: Registre
  complements?: ComplementGlossaire[]
}

async function lireComplements(jeux: string[]): Promise<ComplementGlossaire[]> {
  if (!jeux.length) return []
  return prisma.$queryRaw<ComplementGlossaire[]>`
    SELECT jeu, indicateur, definition, synonymes FROM warehouse.glossaire WHERE jeu = ANY(${jeux}::text[])
  `
}

/** Indicateurs des seuls jeux autorisés au contexte, avec leur formule lisible. */
export async function listerGlossaire(
  contexte: ContexteExecution,
  options: { recherche?: string } = {},
  deps: DependancesGlossaire = {},
): Promise<EntreeGlossaire[]> {
  const registre = await registreAutorise(contexte, deps.registre)
  const complements = deps.complements ?? (await lireComplements(registre.filter(e => e.jeu.mesures.length).map(e => e.jeu.cle)))
  const parIndicateur = new Map(complements.map(c => [`${c.jeu}\u0000${c.indicateur}`, c]))
  const locale = contexte.locale

  const entrees: EntreeGlossaire[] = []
  for (const entree of registre) {
    const visibles = colonnesDe(entree)
    for (const mesure of entree.jeu.mesures) {
      const complement = parIndicateur.get(`${entree.jeu.cle}\u0000${mesure.cle}`)
      const texteComplement = complement?.definition.trim() ?? ''
      entrees.push({
        jeu: { cle: entree.jeu.cle, libelle: entree.jeu.libelle[locale] },
        indicateur: { cle: mesure.cle, libelle: mesure.libelle[locale] },
        definition: texteComplement || mesure.definition,
        complement: texteComplement,
        formule: construireFormule(mesure, locale, visibles),
        unite: mesure.unite ?? mesure.devise ?? null,
        synonymes: complement?.synonymes ?? [],
        ancre: `${entree.jeu.cle}-${mesure.cle}`,
      })
    }
  }

  const requete = normaliser((options.recherche ?? '').trim())
  const retenues = requete
    ? entrees.filter(e =>
        [e.indicateur.libelle, e.definition, e.jeu.libelle, e.jeu.cle, ...e.synonymes].some(t => normaliser(t).includes(requete)))
    : entrees
  return retenues.sort((a, b) =>
    a.jeu.libelle.localeCompare(b.jeu.libelle, locale) || a.indicateur.libelle.localeCompare(b.indicateur.libelle, locale))
}
