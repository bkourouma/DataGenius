import { z } from 'zod'
import { Prisma } from '@prisma/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { citer } from './configuration'
import { prisma } from '@/lib/db/client'
import type { TypeColonne } from '@/lib/medic-assist/contrats'
import type { ColonneVue, EntreeCatalogue, Registre } from '@/lib/medic-assist/donnees/catalogue/types'

const cleJeu = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/)
const cleColonne = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)
const cote = z.enum(['gauche', 'droite'])

export const SelectionJointureSchema = z.strictObject({
  gauche: cleJeu,
  droite: cleJeu,
  type: z.enum(['interne', 'gauche']),
  liens: z.array(z.strictObject({ gauche: cleColonne, droite: cleColonne })).min(1).max(6),
  colonnes: z.array(z.strictObject({ cote, nom: cleColonne })).min(1).max(50),
})

export const JointureSchema = SelectionJointureSchema.extend({
  titre: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300),
})

type SelectionJointure = z.infer<typeof SelectionJointureSchema>
export type Jointure = z.infer<typeof JointureSchema>
export type JointureEnregistree = Jointure & { cle: string }
export class ErreurJointure extends Error {}

export function typesCompatibles(gauche: TypeColonne, droite: TypeColonne) {
  const famille = (type: TypeColonne) => {
    if (type === 'date') return 'date'
    if (type === 'texte' || type === 'periode') return 'texte'
    return 'nombre'
  }
  return famille(gauche) === famille(droite)
}

export function preparerJointure(spec: SelectionJointure, registre: Registre) {
  const gauche = registre.find(e => e.jeu.cle === spec.gauche)
  const droite = registre.find(e => e.jeu.cle === spec.droite)
  if (!gauche || !droite || gauche === droite) {
    throw new ErreurJointure('Sélectionnez deux jeux de données différents et disponibles.')
  }

  const entrees = { gauche, droite }
  const snapshots = [...(gauche.vue.snapshots ?? []), ...(droite.vue.snapshots ?? [])]
  if (snapshots.length > 8) throw new ErreurJointure('Cette combinaison utilise plus de huit imports.')
  const trouver = (entree: EntreeCatalogue, nom: string): ColonneVue => {
    const colonne = entree.vue.colonnes.find(c => c.nom === nom)
    if (!colonne) throw new ErreurJointure('Une colonne sélectionnée est introuvable dans son jeu.')
    return colonne
  }

  const liens = new Set<string>()
  for (const lien of spec.liens) {
    if (!typesCompatibles(trouver(gauche, lien.gauche).type, trouver(droite, lien.droite).type)) {
      throw new ErreurJointure('Les colonnes de chaque liaison doivent avoir des types compatibles.')
    }
    const cle = JSON.stringify([lien.gauche, lien.droite])
    if (liens.has(cle)) throw new ErreurJointure('Une liaison est répétée.')
    liens.add(cle)
  }

  const selections = new Set<string>()
  const noms = new Set<string>()
  const colonnes = spec.colonnes.map(({ cote, nom }) => {
    const cle = JSON.stringify([cote, nom])
    if (selections.has(cle)) throw new ErreurJointure('Une colonne a été sélectionnée deux fois.')
    selections.add(cle)
    const colonne = trouver(entrees[cote], nom)
    const base = nom.slice(0, 58)
    let alias = nom
    for (let i = 2; noms.has(alias); i++) alias = base + '_' + i
    noms.add(alias)
    return {
      cote, origine: nom,
      sortie: {
        nom: alias, type: colonne.type,
        description: alias === nom ? colonne.description : (colonne.description + ' (' + cote + ')').slice(0, 120),
      },
    }
  })
  return { entrees, snapshots, colonnes }
}

export const INDICATEUR_CORRESPONDANCE = '_correspondance'

export function compilerJointure(spec: SelectionJointure, registre: Registre) {
  const { entrees, snapshots, colonnes } = preparerJointure(spec, registre)
  const qualification = (cote: 'gauche' | 'droite', nom: string) => Prisma.sql`${citer(cote)}.${citer(nom)}`
  const projection = colonnes.map(c => Prisma.sql`${qualification(c.cote, c.origine)} AS ${citer(c.sortie.nom)}`)
  const condition = spec.liens.map(lien => Prisma.sql`${qualification('gauche', lien.gauche)} = ${qualification('droite', lien.droite)}`)
  const jointure = spec.type === 'gauche' ? Prisma.sql`LEFT JOIN` : Prisma.sql`INNER JOIN`
  const correspondance = Prisma.sql`${qualification('droite', spec.liens[0].droite)} IS NOT NULL AS ${citer(INDICATEUR_CORRESPONDANCE)}`
  function requete(ctx: ContexteExecution, avecCorrespondance = false) {
    const champs = avecCorrespondance ? [...projection, correspondance] : projection
    return Prisma.sql`
      SELECT ${Prisma.join(champs)} FROM (${entrees.gauche.vue.cte(ctx)}) AS gauche
      ${jointure} (${entrees.droite.vue.cte(ctx)}) AS droite ON ${Prisma.join(condition, ' AND ')}
    `
  }
  return { entrees, snapshots, colonnes: colonnes.map(c => c.sortie), requete }
}

export async function lireJointures(client: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma): Promise<JointureEnregistree[]> {
  const lignes = await client.$queryRaw<{ cle: string; definition: unknown }[]>`
    SELECT cle, definition FROM warehouse.combinaisons ORDER BY position
  `
  return lignes.map(({ cle, definition }) => ({ cle: cleJeu.parse(cle), ...JointureSchema.parse(definition) }))
}
