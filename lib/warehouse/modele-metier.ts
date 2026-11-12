import { Prisma } from '@prisma/client'
import { z } from 'zod'
import type { ColonneVue, DefinitionMesure, EntreeCatalogue, Libelle } from '@/lib/medic-assist/donnees/catalogue/types'
import { CLES_TEMPORELLES } from '@/lib/medic-assist/donnees/moteur/temps'
import { citer, empreinte, identifiant, typeSql } from './configuration'

const texte = z.string().trim().min(1).max(300)
const filtre = z.strictObject({ colonne: identifiant, operateur: z.enum(['egal', 'different']), valeur: z.string().max(300) })
const mesure = z.strictObject({
  cle: identifiant, libelle: texte, description: texte, colonne: identifiant,
  agregat: z.enum(['somme', 'moyenne', 'min', 'max', 'nombre', 'nombre_distinct', 'rapport']),
  denominateur: identifiant.optional(), unite: texte.optional(), devise: z.string().regex(/^[A-Z]{3}$/).optional(),
  filtres: z.array(filtre).max(6).optional(),
})

export const DefinitionMetierSchema = z.strictObject({
  description: texte, grain: texte,
  cles: z.array(identifiant).max(8), dimensions: z.array(identifiant).max(30),
  colonnes: z.array(z.strictObject({ nom: identifiant, description: texte, synonymes: z.array(texte).max(10) })).max(50),
  mesures: z.array(mesure).max(30), calendrier: texte.optional(), responsable: texte.optional(),
  calendrierFiscal: z.strictObject({ colonneDate: identifiant, moisDebutExercice: z.number().int().min(1).max(12) }).optional(),
})

export type DefinitionMetier = z.infer<typeof DefinitionMetierSchema>
export type PublicationMetier = { version: number; definition: DefinitionMetier }

export class ErreurCatalogueMetier extends Error {}

export function colonnesUtiliseesParCatalogue(definition: DefinitionMetier): string[] {
  return [...new Set([
    ...definition.cles, ...definition.dimensions, ...definition.colonnes.map(c => c.nom),
    ...(definition.calendrierFiscal ? [definition.calendrierFiscal.colonneDate] : []),
    ...definition.mesures.flatMap(m => [m.colonne, ...(m.denominateur ? [m.denominateur] : []), ...(m.filtres ?? []).map(f => f.colonne)]),
  ])]
}

const operations = { somme: 'SUM', moyenne: 'AVG', min: 'MIN', max: 'MAX', nombre: 'COUNT', nombre_distinct: 'COUNT' } as const
const libelle = (texte: string): Libelle => ({ fr: texte, en: texte, es: texte, zh: texte, ar: texte, hi: texte })
const typeNumerique = (colonne: ColonneVue) => ['entier', 'decimal', 'montant', 'pourcentage'].includes(colonne.type)

function estEntierPostgres(valeur: string) {
  if (!/^-?\d{1,19}$/.test(valeur)) return false
  const entier = BigInt(valeur)
  return entier >= BigInt('-9223372036854775808') && entier <= BigInt('9223372036854775807')
}

function indexerColonnes(colonnes: ColonneVue[]) {
  const index = new Map(colonnes.map(colonne => [colonne.nom, colonne]))
  return (nom: string) => {
    const colonne = index.get(nom)
    if (!colonne) throw new ErreurCatalogueMetier(`La colonne « ${nom} » est indisponible.`)
    return colonne
  }
}

function exigerUnicite(valeurs: string[]) {
  if (new Set(valeurs).size !== valeurs.length) throw new ErreurCatalogueMetier('Chaque clé, dimension et mesure doit être unique.')
}

export function appliquerPublicationMetier(entree: EntreeCatalogue, publication: PublicationMetier): EntreeCatalogue {
  const { version, definition } = publication
  exigerUnicite(definition.cles)
  exigerUnicite(definition.colonnes.map(c => c.nom))
  exigerUnicite([...definition.dimensions, ...definition.mesures.map(m => m.cle)])

  const trouver = indexerColonnes(entree.vue.colonnes)
  for (const nom of [...definition.cles, ...definition.colonnes.map(c => c.nom)]) trouver(nom)
  const calendrier = definition.calendrierFiscal
  if (calendrier) {
    if (trouver(calendrier.colonneDate).type !== 'date') throw new ErreurCatalogueMetier('Sélectionnez une colonne de type date pour le calendrier.')
    const conflit = [...definition.dimensions, ...definition.mesures.map(m => m.cle)].find(cle => CLES_TEMPORELLES.has(cle))
    if (conflit) throw new ErreurCatalogueMetier(`La clé « ${conflit} » est utilisée par le calendrier. Retirez la dimension ou renommez l’indicateur.`)
  }
  const descriptions = new Map(definition.colonnes.map(c => [c.nom, c]))
  const colonnes = entree.vue.colonnes.map(c => ({ ...c, ...descriptions.get(c.nom) }))
  const enrichie = indexerColonnes(colonnes)
  const dimensions = definition.dimensions.map(cle => {
    const colonne = enrichie(cle)
    return { cle, libelle: libelle(colonne.description), definition: colonne.description, type: colonne.type, expression: citer(cle).sql }
  })
  const mesures = definition.mesures.map((m): DefinitionMesure => {
    const colonne = trouver(m.colonne)
    const compte = m.agregat === 'nombre' || m.agregat === 'nombre_distinct'
    const rapport = m.agregat === 'rapport'
    if (rapport !== Boolean(m.denominateur)) throw new ErreurCatalogueMetier('Un rapport exige une colonne au dénominateur.')
    if ((!compte && !typeNumerique(colonne)) || (m.denominateur && !typeNumerique(trouver(m.denominateur)))) {
      throw new ErreurCatalogueMetier(`L’indicateur « ${m.libelle} » exige des colonnes numériques.`)
    }
    const conditions = (m.filtres ?? []).map(f => {
      const source = trouver(f.colonne)
      if ((source.type === 'entier' && !estEntierPostgres(f.valeur)) ||
          (source.type !== 'entier' && typeNumerique(source) && !/^-?\d+(\.\d+)?$/.test(f.valeur))) {
        throw new ErreurCatalogueMetier(`Le filtre sur « ${f.colonne} » exige une valeur numérique.`)
      }
      if (source.type === 'date') {
        const date = new Date(f.valeur + 'T00:00:00.000Z')
        if (f.valeur.startsWith('0000') || !/^\d{4}-\d{2}-\d{2}$/.test(f.valeur) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== f.valeur) {
          throw new ErreurCatalogueMetier(`Le filtre sur « ${f.colonne} » exige une date valide (AAAA-MM-JJ).`)
        }
      }
      return Prisma.sql`${citer(f.colonne)} ${Prisma.raw(f.operateur === 'egal' ? '=' : '<>')} ${f.valeur}::${typeSql(source.type)}`
    })
    const clause = conditions.length ? Prisma.sql` FILTER (WHERE ${Prisma.join(conditions, ' AND ')})` : Prisma.empty
    const champ = citer(m.colonne)
    const expression = rapport && m.denominateur
      ? Prisma.sql`(SUM(${champ})${clause})::numeric / NULLIF(SUM(${citer(m.denominateur)})${clause}, 0)`
      : Prisma.sql`${Prisma.raw(operations[m.agregat as keyof typeof operations])}(${m.agregat === 'nombre_distinct' ? Prisma.sql`DISTINCT ` : Prisma.empty}${champ})${clause}`
    return {
      cle: m.cle, libelle: libelle(m.libelle), definition: m.description, agregat: m.agregat, expression,
      type: compte || (colonne.type === 'entier' && !rapport && m.agregat !== 'moyenne') ? 'entier' : 'decimal',
      unite: m.unite || m.devise, devise: m.devise,
      colonnesRequises: [...new Set([m.colonne, ...(m.denominateur ? [m.denominateur] : []), ...(m.filtres ?? []).map(f => f.colonne)])],
      regles: (m.filtres ?? []).map(f => libelle(`${f.colonne} ${f.operateur === 'egal' ? '=' : '≠'} ${f.valeur}`)),
    }
  })
  return {
    jeu: {
      ...entree.jeu, description: definition.description, granularite: definition.grain,
      dimensions, mesures, cles: definition.cles, calendrier: definition.calendrier,
      temps: calendrier ? { defaut: 'aucune', calendrier } : entree.jeu.temps?.calendrier ? undefined : entree.jeu.temps,
      responsable: definition.responsable, versionMetier: version,
      filtres: dimensions.filter(d => d.type === 'texte' || d.type === 'periode').map(d => ({
        cle: d.cle, libelle: d.libelle, definition: `Valeur exacte : ${d.definition}`, type: 'texte',
        condition: valeur => Prisma.sql`${citer(d.cle)} = ${String(valeur)}`,
      })),
      regles: [...entree.jeu.regles, libelle(`Catalogue métier v${version}`)],
    },
    vue: { ...entree.vue, description: definition.description, colonnes, signature: empreinte([entree.vue.signature, version, definition]) },
  }
}

export async function publicationsMetier(client: Pick<Prisma.TransactionClient, '$queryRaw'>) {
  const lignes = await client.$queryRaw<{ jeu: string; version: number; definition: unknown }[]>`
    SELECT DISTINCT ON (jeu) jeu, version, definition
    FROM warehouse.catalogue_metier ORDER BY jeu, version DESC
  `
  return new Map(lignes.map(ligne => [ligne.jeu, { version: ligne.version, definition: DefinitionMetierSchema.parse(ligne.definition) }]))
}
