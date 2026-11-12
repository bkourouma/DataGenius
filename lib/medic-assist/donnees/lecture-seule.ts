import { Prisma } from '@prisma/client'
import { nombreAnalytique } from '@/lib/medic-assist/contrats/numerique'
import { transactionLecture } from '@/lib/warehouse/postgres'
import type { DefinitionVue } from './catalogue/types'
import { ErreurDonnees } from './types'

type Publication = {
  publie_a: Date
  verifie_a: Date | null
  verification_ok: boolean | null
  en_retard: boolean | null
}

export async function lireEntrepot(requetes: Prisma.Sql[], vues: DefinitionVue[], delaiMs?: number) {
  return transactionLecture('DATAGENIUS_WAREHOUSE_READ_URL', async tx => {
    const publications = new Map<string, Publication>()
    for (const snapshot of vues.flatMap(vue => vue.snapshots ?? [])) {
      if (publications.has(snapshot.jeu)) continue
      const [copie] = await tx.$queryRaw<Publication[]>`
        SELECT publie_a, verifie_a, verification_ok, fraiche_jusqua < now() AS en_retard
        FROM warehouse.snapshots WHERE jeu = ${snapshot.jeu} AND empreinte = ${snapshot.empreinte}
      `
      if (!copie) throw new ErreurDonnees('Ce jeu attend sa première synchronisation.', 'sql_erreur')
      publications.set(snapshot.jeu, copie)
    }
    const resultats: Record<string, unknown>[][] = []
    for (const requete of requetes) resultats.push(await tx.$queryRaw<Record<string, unknown>[]>(requete))
    return { resultats, publications }
  }, delaiMs)
}

export function reglesPublication(vues: DefinitionVue[], publications: Map<string, Publication>) {
  return [...new Map(vues.flatMap(vue => vue.snapshots ?? []).map(s => [s.jeu, s])).values()].flatMap(snapshot => {
    const copie = publications.get(snapshot.jeu)
    if (!copie) return []
    const source = snapshot.source.slice(0, 200)
    const regles = ['Source : ' + source + ' · copie publiée le ' + copie.publie_a.toISOString()]
    if (copie.verification_ok === false) regles.push('Source : ' + source + ' · dernière synchronisation en échec. La dernière copie valide est utilisée.')
    else if (copie.en_retard) regles.push('Source : ' + source + ' · vérification en retard.')
    else if (copie.verifie_a) regles[0] += ' · vérifiée le ' + copie.verifie_a.toISOString()
    return regles
  })
}

export function normaliserValeur(valeur: unknown): unknown {
  if (valeur === null || valeur === undefined) return null
  if (typeof valeur === 'bigint') {
    return nombreAnalytique(valeur.toString())
  }
  if (valeur instanceof Date) {
    const iso = valeur.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
  }
  if (Prisma.Decimal.isDecimal(valeur)) return nombreAnalytique(valeur.toFixed())
  if (Array.isArray(valeur)) return valeur.map(normaliserValeur)
  return valeur
}

export function normaliserLigne(ligne: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ligne).map(([cle, valeur]) => [cle, normaliserValeur(valeur)]))
}
