import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { TypeColonneSchema } from '@/lib/medic-assist/contrats/donnees'
import { prisma } from '@/lib/db/client'
import { identitePostgres } from './postgres'

export const identifiant = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)
// PostgreSQL accepte des noms mixtes et des espaces. Toujours les citer comme identifiants.
const identifiantOrigine = z.string().min(1).refine(s => !s.includes('\0') && Buffer.byteLength(s) <= 63)
const texte = z.string().trim().min(1).max(300)
const colonne = z.strictObject({
  nom: identifiant,
  origine: identifiantOrigine.optional(),
  type: TypeColonneSchema,
  description: texte,
})
const mesure = z.strictObject({
  cle: identifiant,
  colonne: identifiant,
  agregat: z.enum(['somme', 'moyenne', 'min', 'max', 'nombre', 'nombre_distinct']),
  definition: texte,
  unite: texte.optional(),
  instantane: z.boolean().optional(),
})
const jeuCommun = z.strictObject({
  cle: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
  titre: texte,
  description: texte,
  grain: texte,
  colonnes: z.array(colonne).min(1).max(50),
  dimensions: z.array(identifiant).max(30),
  instantanePar: identifiant.optional(),
  mesures: z.array(mesure).max(30),
})
export const jeuSchema = jeuCommun.extend({
  schema: identifiantOrigine,
  table: identifiantOrigine,
  frequenceMinutes: z.number().int().min(1).max(10080),
})
const combinaison = jeuCommun.extend({ sql: z.string().trim().min(1).max(20_000) })
const source = z.strictObject({
  id: identifiant,
  titre: texte,
  connexion: z.string().regex(/^DATAGENIUS_SOURCE_[A-Z0-9_]+$/),
  jeux: z.array(jeuSchema).min(1).max(30),
})
const configuration = z.strictObject({
  sources: z.array(source).max(20),
  combinaisons: z.array(combinaison).max(30).default([]),
})

export type JeuCompose = z.infer<typeof combinaison>
export type JeuConfigure = z.infer<typeof jeuSchema>
export type TypeSource = 'postgresql' | 'mysql' | 'rest' | 'fichier'
export type JeuEntrepot = {
  jeu: JeuConfigure
  source: { id: string; titre: string; connexion?: string; type?: TypeSource }
  empreinte: string
}

export function citer(nom: string): Prisma.Sql {
  return Prisma.raw('"' + identifiantOrigine.parse(nom).replaceAll('"', '""') + '"')
}

export function typeSql(type: z.infer<typeof TypeColonneSchema>): Prisma.Sql {
  switch (type) {
    case 'date': return Prisma.raw('date')
    case 'entier': return Prisma.raw('bigint')
    case 'decimal':
    case 'montant':
    case 'pourcentage': return Prisma.raw('numeric')
    default: return Prisma.raw('text')
  }
}

export function empreinte(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function lireConfiguration(brut: unknown) {
  const { sources, combinaisons } = configuration.parse(brut)
  if (new Set(sources.map(s => s.id)).size !== sources.length) throw new Error('Identifiants de sources en double.')
  const jeux = sources.flatMap(({ jeux, ...source }) => jeux.map(jeu => {
    // Une modification de fréquence ou de libellé ne change pas la copie publiée.
    const projection = jeu.colonnes.map(c => [c.nom, c.origine ?? c.nom, c.type])
    const connexion = identitePostgres(source.connexion) ?? source.connexion
    return { jeu, source, empreinte: empreinte([source.id, connexion, jeu.schema, jeu.table, projection]) }
  }))
  const cles = [...jeux.map(e => e.jeu.cle), ...combinaisons.map(e => e.cle)]
  if (new Set(cles).size !== cles.length) throw new Error('Clés de jeux en double.')
  return { jeux, combinaisons }
}

let catalogue: ReturnType<typeof lireConfiguration> | undefined

export function configurationFichier() {
  if (!process.env.DATAGENIUS_CATALOGUE) return { jeux: [], combinaisons: [] }
  catalogue ??= lireConfiguration(JSON.parse(readFileSync(process.env.DATAGENIUS_CATALOGUE, 'utf8')))
  return catalogue
}

export async function configurationEntrepot(client: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma) {
  const fichier = configurationFichier()
  const imports = await client.$queryRaw<{
    id: string; titre: string; type: TypeSource; definition: object; frequence_minutes: number
  }[]>`
    SELECT s.id, s.titre, s.type, i.definition, i.frequence_minutes
    FROM warehouse.imports i JOIN warehouse.sources s ON i.source_id = s.id ORDER BY i.cle
  `
  const geres: JeuEntrepot[] = imports.map(({ id, titre, type, definition, frequence_minutes }) => {
    const jeu = jeuSchema.parse({ ...definition, frequenceMinutes: frequence_minutes })
    const projection = jeu.colonnes.map(c => [c.nom, c.origine ?? c.nom, c.type])
    return { jeu, source: { id, titre, type }, empreinte: empreinte([id, jeu.schema, jeu.table, projection]) }
  })
  return { jeux: [...fichier.jeux, ...geres], combinaisons: fichier.combinaisons }
}

export async function jeuxEntrepot() {
  return (await configurationEntrepot()).jeux
}
