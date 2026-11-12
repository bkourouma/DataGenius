import { Prisma } from '@prisma/client'
import { citer } from '@/lib/warehouse/configuration'
import { peutConsulterJeu, restrictionsActives, type DroitsDonnees, type RegleDonnees } from '@/lib/auth/data-access'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { empreinteEntrees, registrePostgres } from './registre'
import type { EntreeCatalogue, Registre } from './types'

const originales = new WeakMap<EntreeCatalogue, EntreeCatalogue>()

function restreindre(entree: EntreeCatalogue, regle: RegleDonnees): EntreeCatalogue | null {
  const { vue, jeu } = entree
  const filtre = regle.filtre
  const disponibles = new Set(vue.colonnes.map(c => c.nom))
  if ((filtre && !disponibles.has(filtre.colonne)) || regle.masquer.some(nom => !disponibles.has(nom))) return null
  const colonnes = vue.colonnes.filter(c => !regle.masquer.includes(c.nom))
  if (colonnes.length === 0) return null
  const noms = new Set(colonnes.map(c => c.nom))
  const masque = colonnes.length !== vue.colonnes.length
  const restreinte: EntreeCatalogue = {
    jeu: masque ? {
      ...jeu,
      temps: jeu.temps?.calendrier && !noms.has(jeu.temps.calendrier.colonneDate) ? undefined : jeu.temps,
      dimensions: jeu.dimensions.filter(d => noms.has(d.cle)),
      filtres: jeu.filtres.filter(f => noms.has(f.cle)),
      cles: jeu.cles?.filter(c => noms.has(c)),
      // Les mesures historiques n'exposent pas leurs dépendances SQL.
      mesures: jeu.mesures.filter(m => m.colonnesRequises?.length && m.colonnesRequises.every(c => noms.has(c))),
    } : jeu,
    vue: {
      ...vue,
      colonnes,
      cte: ctx => {
        const condition = filtre ? Prisma.sql`WHERE ${citer(filtre.colonne)}::text = ${filtre.valeur}` : Prisma.empty
        return Prisma.sql`SELECT ${Prisma.join(colonnes.map(c => citer(c.nom)))} FROM (${vue.cte(ctx)}) AS autorise ${condition}`
      },
    },
  }
  originales.set(restreinte, entree)
  return restreinte
}

export function appliquerDroitsRegistre(registre: Registre, droits: DroitsDonnees | undefined): Registre {
  if (!restrictionsActives(droits) || droits.administrateur) return registre
  const autorise = new Map<string, { entree: EntreeCatalogue; restreinte: boolean }>()
  // Les imports précèdent les combinaisons et chaque combinaison précède celles qui l'utilisent.
  for (const entree of registre) {
    if (entree.vue.dependances?.some(cle => autorise.get(cle)?.restreinte !== false)) continue
    if (!peutConsulterJeu(droits, entree.jeu.cle)) continue
    const regle = droits.regles.get(entree.jeu.cle)
    if (!regle) {
      autorise.set(entree.jeu.cle, { entree, restreinte: false })
      continue
    }
    const restreinte = regle.filtre !== null || regle.masquer.length > 0
    const selection = restreinte ? restreindre(entree, regle) : entree
    if (selection) autorise.set(entree.jeu.cle, { entree: selection, restreinte })
  }
  return [...autorise.values()].map(e => e.entree)
}

export async function registreAutorise(contexte?: ContexteExecution, registre?: Registre) {
  return appliquerDroitsRegistre(registre ?? await registrePostgres(), contexte?.scope.donnees)
}

/** L'empreinte de source est indépendante des droits, versionnés dans l'empreinte de périmètre. */
export function empreinteEntreesAutorisees(entrees: EntreeCatalogue[]) {
  return empreinteEntrees(entrees.map(entree => originales.get(entree) ?? entree))
}
