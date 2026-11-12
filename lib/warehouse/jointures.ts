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
  const cotes = ['gauche', 'droite'] as const
  const numeriques = colonnes.filter(c => c.sortie.type === 'entier' || c.sortie.type === 'decimal')
  function diagnostic(ctx: ContexteExecution) {
    const cles = spec.liens.map((_, index) => citer('k' + index))
    const compte = { gauche: Prisma.sql`g.n`, droite: Prisma.sql`d.n` }
    const valides = { gauche: Prisma.sql`g.valide`, droite: Prisma.sql`d.valide` }
    const groupes = (cote: typeof cotes[number]) => {
      const origines = spec.liens.map(lien => citer(lien[cote]))
      const projection = origines.map((nom, index) => Prisma.sql`${nom} AS ${cles[index]}`)
      const valide = Prisma.join(origines.map(nom => Prisma.sql`${nom} IS NOT NULL`), ' AND ')
      const sommes = numeriques.flatMap((colonne, index) => colonne.cote === cote
        ? [Prisma.sql`sum(${citer(colonne.origine)}::numeric) AS ${citer('s' + index)}`] : [])
      return Prisma.sql`
        SELECT ${Prisma.join([...projection, ...sommes])}, (${valide}) AS valide, count(*)::numeric AS n
        FROM (${entrees[cote].vue.cte(ctx)}) AS source GROUP BY ${Prisma.join(origines)}
      `
    }
    const lies = Prisma.sql`g.n IS NOT NULL AND d.n IS NOT NULL`
    const poidsGauche = spec.type === 'gauche' ? Prisma.sql`coalesce(d.n, 1)` : compte.droite
    const agregats = cotes.flatMap(cote => {
      const n = compte[cote]
      const autre = compte[cote === 'gauche' ? 'droite' : 'gauche']
      return [
        Prisma.sql`coalesce(sum(${n}), 0)::text AS ${citer(cote + '_lignes')}`,
        Prisma.sql`coalesce(sum(${n}) FILTER (WHERE ${lies}), 0)::text AS ${citer(cote + '_correspondances')}`,
        Prisma.sql`coalesce(sum(${n}) FILTER (WHERE ${autre} IS NULL), 0)::text AS ${citer(cote + '_sans_correspondance')}`,
        Prisma.sql`coalesce(sum(${n}) FILTER (WHERE NOT ${valides[cote]}), 0)::text AS ${citer(cote + '_lignes_cle_nulle')}`,
        Prisma.sql`count(*) FILTER (WHERE ${valides[cote]} AND ${n} > 1)::text AS ${citer(cote + '_cles_dupliquees')}`,
        Prisma.sql`coalesce(sum(${n}) FILTER (WHERE ${autre} > 1), 0)::text AS ${citer(cote + '_lignes_multipliees')}`,
      ]
    })
    const totaux = numeriques.flatMap((colonne, index) => {
      const source = citer(colonne.cote === 'gauche' ? 'g' : 'd')
      const somme = Prisma.sql`${source}.${citer('s' + index)}`
      const poids = colonne.cote === 'gauche' ? poidsGauche : compte.gauche
      return [
        Prisma.sql`sum(${somme})::text AS ${citer('avant' + index)}`,
        Prisma.sql`sum(${somme} * ${poids})::text AS ${citer('apres' + index)}`,
      ]
    })
    return Prisma.sql`
      SELECT coalesce(sum(g.n * ${poidsGauche}), 0)::text AS resultat,
        ${Prisma.join([...agregats, ...totaux])}
      FROM (${groupes('gauche')}) AS g FULL JOIN (${groupes('droite')}) AS d
      ON ${Prisma.join(cles.map(cle => Prisma.sql`g.${cle} = d.${cle}`), ' AND ')}
    `
  }
  return { entrees, snapshots, colonnes: colonnes.map(c => c.sortie), requete, diagnostic, numeriques }
}

export async function lireJointures(client: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma): Promise<JointureEnregistree[]> {
  const lignes = await client.$queryRaw<{ cle: string; definition: unknown }[]>`
    SELECT cle, definition FROM warehouse.combinaisons ORDER BY position
  `
  return lignes.map(({ cle, definition }) => ({ cle: cleJeu.parse(cle), ...JointureSchema.parse(definition) }))
}
