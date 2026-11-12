import type { TypeColonne } from '@/lib/medic-assist/contrats'
import type { JeuConfigure } from '../configuration'

export const MAX_LIGNES_SOURCE = 50_000
export const MAX_OCTETS_SOURCE = 20 * 1024 * 1024
export type TableSource = { schema: string; table: string }
export type ColonneSource = { nom: string; typePostgres: string; type: TypeColonne }
export type LectureSource = { lignes: number; contenu: string | null }

export interface Connecteur<Configuration> {
  tables(configuration: Configuration, recherche: string): Promise<{ tables: TableSource[]; tronque: boolean }>
  colonnes(configuration: Configuration, table: TableSource): Promise<ColonneSource[]>
  lire(configuration: Configuration, jeu: JeuConfigure): Promise<LectureSource>
}

export function correspondRecherche(table: TableSource, recherche: string) {
  return `${table.schema}.${table.table}`.toLowerCase().includes(recherche.slice(0, 120).toLowerCase())
}

export async function publierLignes(jeu: JeuConfigure, lignes: Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>>): Promise<LectureSource> {
  const selection: string[] = []
  let octets = 2
  for await (const ligne of lignes) {
    const projection = Object.fromEntries(jeu.colonnes.map(({ nom, origine, type }) => {
      const cle = origine ?? nom
      if (!Object.hasOwn(ligne, cle)) throw new Error('Colonne source indisponible.')
      const valeur = ligne[cle]
      if (valeur === null || valeur === undefined) return [nom, null]
      const texte = typeof valeur === 'object' ? JSON.stringify(valeur) : String(valeur)
      if (type === 'entier' && (!/^-?\d{1,19}$/.test(texte) || BigInt(texte) < BigInt('-9223372036854775808') || BigInt(texte) > BigInt('9223372036854775807'))) {
        throw new Error('Entier hors limites de l’entrepôt.')
      }
      if (type !== 'texte' && type !== 'periode' && type !== 'entier' && type !== 'date' &&
          (texte.length > 2048 || !/^-?\d+(?:\.\d+)?(?:e[+-]?\d{1,3})?$/i.test(texte))) throw new Error('Nombre source invalide.')
      if (type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(texte) || !dateISO(texte))) throw new Error('Date source invalide.')
      return [nom, texte]
    }))
    const texte = JSON.stringify(projection)
    octets += Buffer.byteLength(texte) + (selection.length ? 1 : 0)
    if (octets > MAX_OCTETS_SOURCE || selection.length >= MAX_LIGNES_SOURCE) return { lignes: selection.length + 1, contenu: null }
    selection.push(texte)
  }
  return { lignes: selection.length, contenu: '[' + selection.sort().join(',') + ']' }
}

function dateISO(valeur: string) {
  const date = new Date(valeur + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === valeur
}
