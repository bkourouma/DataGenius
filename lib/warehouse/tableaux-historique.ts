import type { DefinitionTableau } from './tableaux-modeles'

// Versions conservées AU TOTAL : la courante + (VERSIONS_CONSERVEES - 1) archives.
export const VERSIONS_CONSERVEES = 50
export const ARCHIVES_CONSERVEES = VERSIONS_CONSERVEES - 1

export type ResumeChangements = {
  ajoutees: number
  retirees: number
  modifiees: number
  titreModifie: boolean
  lecteursModifies: boolean
}

function triee(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(triee)
  if (valeur && typeof valeur === 'object') {
    return Object.fromEntries(Object.entries(valeur as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([cle, v]) => [cle, triee(v)]))
  }
  return valeur
}

const canonique = (valeur: unknown) => JSON.stringify(triee(valeur))

export function resumerChangements(avant: DefinitionTableau | null, apres: DefinitionTableau): ResumeChangements {
  if (!avant) {
    return { ajoutees: apres.tuiles.length, retirees: 0, modifiees: 0, titreModifie: false, lecteursModifies: false }
  }
  const anciennes = new Map(avant.tuiles.map(t => [t.id, canonique(t)]))
  const actuelles = new Map(apres.tuiles.map(t => [t.id, canonique(t)]))
  let ajoutees = 0
  let modifiees = 0
  for (const [id, contenu] of actuelles) {
    const ancien = anciennes.get(id)
    if (ancien === undefined) ajoutees++
    else if (ancien !== contenu) modifiees++
  }
  const retirees = [...anciennes.keys()].filter(id => !actuelles.has(id)).length
  const a = new Set(avant.lecteurs)
  const b = new Set(apres.lecteurs)
  return {
    ajoutees, retirees, modifiees,
    titreModifie: avant.titre !== apres.titre,
    lecteursModifies: a.size !== b.size || [...a].some(l => !b.has(l)),
  }
}
