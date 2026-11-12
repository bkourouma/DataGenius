import { Prisma } from '@prisma/client'
import { transactionLecture } from '@/lib/warehouse/postgres'
import type { DefinitionVue } from './catalogue/types'
import { ErreurDonnees } from './types'

export async function lireEntrepot(requetes: Prisma.Sql[], vues: DefinitionVue[], delaiMs?: number) {
  return transactionLecture('DATAGENIUS_WAREHOUSE_READ_URL', async tx => {
    const publications = new Map<string, Date>()
    for (const snapshot of vues.flatMap(vue => vue.snapshots ?? [])) {
      if (publications.has(snapshot.jeu)) continue
      const [copie] = await tx.$queryRaw<{ publie_a: Date }[]>`
        SELECT publie_a FROM warehouse.snapshots WHERE jeu = ${snapshot.jeu} AND empreinte = ${snapshot.empreinte}
      `
      if (!copie) throw new ErreurDonnees('Ce jeu attend sa première synchronisation.', 'sql_erreur')
      publications.set(snapshot.jeu, copie.publie_a)
    }
    const resultats: Record<string, unknown>[][] = []
    for (const requete of requetes) resultats.push(await tx.$queryRaw<Record<string, unknown>[]>(requete))
    return { resultats, publications }
  }, delaiMs)
}

export function reglesPublication(vues: DefinitionVue[], publications: Map<string, Date>) {
  return [...new Map(vues.flatMap(vue => vue.snapshots ?? []).map(s => [s.jeu, s])).values()].flatMap(snapshot => {
    const date = publications.get(snapshot.jeu)
    return date ? ['Source : ' + snapshot.source.slice(0, 200) + ' · copie publiée le ' + date.toISOString()] : []
  })
}

export function normaliserValeur(valeur: unknown): unknown {
  if (valeur === null || valeur === undefined) return null
  if (typeof valeur === 'bigint') {
    const n = Number(valeur)
    return Number.isSafeInteger(n) ? n : valeur.toString()
  }
  if (valeur instanceof Date) {
    const iso = valeur.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
  }
  if (Prisma.Decimal.isDecimal(valeur)) return valeur.toNumber()
  if (Array.isArray(valeur)) return valeur.map(normaliserValeur)
  return valeur
}

export function normaliserLigne(ligne: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ligne).map(([cle, valeur]) => [cle, normaliserValeur(valeur)]))
}
