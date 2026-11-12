import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { identifiant, type JeuConfigure } from './configuration'

const valeur = z.string().max(300)
export const DefinitionQualiteSchema = z.strictObject({
  filtres: z.array(z.strictObject({ colonne: identifiant, operateur: z.enum(['egal', 'different', 'non_nul']), valeur: valeur.optional() })).max(20),
  normalisations: z.array(z.strictObject({ colonne: identifiant, operation: z.enum(['espaces', 'minuscules', 'majuscules', 'vide_en_null']) })).max(20),
  controles: z.array(z.strictObject({ colonnes: z.array(identifiant).min(1).max(8), type: z.enum(['unique', 'non_nul', 'plage']), min: valeur.optional(), max: valeur.optional() })).max(20),
})

export type DefinitionQualite = z.infer<typeof DefinitionQualiteSchema>
export const definitionQualiteVide: DefinitionQualite = { filtres: [], normalisations: [], controles: [] }
export type LigneImport = Record<string, string | null>
type Colonne = JeuConfigure['colonnes'][number]

export class ErreurQualite extends Error {}

export const messagesExecution: Readonly<Record<string, string>> = {
  volume: 'Le volume dépasse la limite de cet import.',
  schema: 'Une table, une colonne ou un type ne correspond plus à la définition de l’import.',
  source: 'La source ne répond pas ou le compte de lecture ne dispose plus des accès nécessaires.',
  non_nul: 'Une valeur obligatoire est absente.',
  unique: 'Une clé se répète dans les données préparées.',
  plage: 'Une valeur est hors des bornes autorisées.',
  configuration: 'La définition de préparation est incompatible avec les colonnes de cet import.',
}

const numerique = (type: Colonne['type']) => ['entier', 'decimal', 'montant', 'pourcentage'].includes(type)

function valeurTypee(texte: string, type: Colonne['type']) {
  if (numerique(type)) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(texte) || (type === 'entier' && !/^[+-]?\d+$/.test(texte))) {
      throw new ErreurQualite('Saisissez une valeur numérique du type de la colonne.')
    }
    const nombre = new Prisma.Decimal(texte)
    if (!nombre.isFinite()) throw new ErreurQualite('Saisissez une valeur numérique finie.')
    return nombre
  }
  if (type === 'date') {
    const date = new Date(texte + 'T00:00:00Z')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texte) || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== texte) {
      throw new ErreurQualite('Saisissez une date valide (AAAA-MM-JJ).')
    }
  }
  return texte
}

function comparer(a: ReturnType<typeof valeurTypee>, b: ReturnType<typeof valeurTypee>) {
  if (typeof a === 'string' && typeof b === 'string') return a === b ? 0 : a < b ? -1 : 1
  if (a instanceof Prisma.Decimal && b instanceof Prisma.Decimal) return a.comparedTo(b)
  throw new ErreurQualite('Les valeurs comparées doivent avoir le même type.')
}

function trouverType(jeu: JeuConfigure) {
  const types = new Map(jeu.colonnes.map(({ nom, type }) => [nom, type]))
  return (nom: string) => {
    const type = types.get(nom)
    if (!type) throw new ErreurQualite(`La colonne « ${nom} » est indisponible.`)
    return type
  }
}

export function validerDefinitionQualite(jeu: JeuConfigure, entree: unknown) {
  const validation = DefinitionQualiteSchema.safeParse(entree)
  if (!validation.success) throw new ErreurQualite('Vérifiez les filtres, les normalisations et les contrôles.')
  const definition = validation.data
  const type = trouverType(jeu)
  for (const filtre of definition.filtres) {
    const typeColonne = type(filtre.colonne)
    if (filtre.operateur !== 'non_nul') {
      if (filtre.valeur === undefined) throw new ErreurQualite('Renseignez la valeur du filtre.')
      valeurTypee(filtre.valeur, typeColonne)
    }
  }
  for (const normalisation of definition.normalisations) {
    if (!['texte', 'periode'].includes(type(normalisation.colonne))) throw new ErreurQualite('Les normalisations s’appliquent aux colonnes de texte.')
  }
  for (const controle of definition.controles) {
    const types = controle.colonnes.map(type)
    if (new Set(controle.colonnes).size !== controle.colonnes.length) throw new ErreurQualite('Sélectionnez chaque colonne une seule fois dans un contrôle.')
    if (controle.type === 'plage') {
      const [colonne] = types
      if (types.length !== 1 || (!numerique(colonne) && colonne !== 'date')) throw new ErreurQualite('Une plage exige une colonne numérique ou une date.')
      if (controle.min === undefined && controle.max === undefined) throw new ErreurQualite('Renseignez au moins une borne.')
      const min = controle.min === undefined ? undefined : valeurTypee(controle.min, colonne)
      const max = controle.max === undefined ? undefined : valeurTypee(controle.max, colonne)
      if (min !== undefined && max !== undefined && comparer(min, max) > 0) throw new ErreurQualite('La borne minimale dépasse la borne maximale.')
    }
  }
  return definition
}

export function preparerLignes(jeu: JeuConfigure, definition: DefinitionQualite, lignes: LigneImport[]) {
  const type = trouverType(jeu)
  const filtres = definition.filtres.map(({ colonne, operateur, valeur }) => {
    if (operateur === 'non_nul') return (ligne: LigneImport) => ligne[colonne] != null
    const typeColonne = type(colonne)
    const attendue = valeurTypee(valeur!, typeColonne)
    return (ligne: LigneImport) => {
      const brute = ligne[colonne]
      if (brute == null) return false
      const egale = comparer(valeurTypee(brute, typeColonne), attendue) === 0
      return operateur === 'egal' ? egale : !egale
    }
  })

  const selection = lignes.filter(ligne => {
    for (const { colonne, operation } of definition.normalisations) {
      const brute = ligne[colonne]
      if (brute == null) continue
      if (operation === 'espaces') ligne[colonne] = brute.trim()
      if (operation === 'minuscules') ligne[colonne] = brute.toLowerCase()
      if (operation === 'majuscules') ligne[colonne] = brute.toUpperCase()
      if (operation === 'vide_en_null' && brute.trim() === '') ligne[colonne] = null
    }
    return filtres.every(filtre => filtre(ligne))
  })

  for (const { type: controle, colonnes, min, max } of definition.controles) {
    if (controle === 'non_nul' && selection.some(ligne => colonnes.some(colonne => ligne[colonne] == null))) return { selection, code: controle }
    if (controle === 'unique') {
      const cles = new Set<string>()
      const types = colonnes.map(type)
      for (const ligne of selection) {
        const cle = JSON.stringify(colonnes.map((colonne, i) => {
          const valeur = ligne[colonne]
          return valeur == null ? null : valeurTypee(valeur, types[i]).toString()
        }))
        if (cles.has(cle)) return { selection, code: controle }
        cles.add(cle)
      }
    }
    if (controle === 'plage') {
      const [colonne] = colonnes
      const typeColonne = type(colonne)
      const minimale = min === undefined ? undefined : valeurTypee(min, typeColonne)
      const maximale = max === undefined ? undefined : valeurTypee(max, typeColonne)
      if (selection.some(ligne => {
        if (ligne[colonne] == null) return false
        const nombre = valeurTypee(ligne[colonne], typeColonne)
        return (minimale !== undefined && comparer(nombre, minimale) < 0) || (maximale !== undefined && comparer(nombre, maximale) > 0)
      })) return { selection, code: controle }
    }
  }
  return { selection, code: null }
}
