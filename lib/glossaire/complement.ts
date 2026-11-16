import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { registreAutorise } from '@/lib/medic-assist/donnees/catalogue/autorisation'
import type { Registre } from '@/lib/medic-assist/donnees/catalogue/types'

export type CodeErreurGlossaire = 'interdit' | 'introuvable' | 'invalide'

export class ErreurGlossaire extends Error {
  constructor(readonly code: CodeErreurGlossaire) {
    super(code)
  }
}

const synonyme = z.string().trim().min(1).max(60)

export const ComplementSchema = z.strictObject({
  jeu: z.string().min(1).max(100),
  indicateur: z.string().min(1).max(100),
  definition: z.string().trim().max(600),
  synonymes: z.array(synonyme).max(10).transform(liste => {
    const vus = new Set<string>()
    return liste.filter(s => {
      const cle = s.toLocaleLowerCase()
      if (vus.has(cle)) return false
      vus.add(cle)
      return true
    })
  }),
})

export type ComplementEntree = z.input<typeof ComplementSchema>

/**
 * Enregistre (ou supprime, si tout est vide) le complément d'un indicateur.
 * Réservé au TenantAdmin ; l'indicateur doit exister dans son registre autorisé.
 */
export async function enregistrerComplementGlossaire(
  contexte: ContexteExecution,
  entree: ComplementEntree,
  deps: { registre?: Registre } = {},
): Promise<{ supprime: boolean }> {
  if (contexte.roleName !== 'TenantAdmin') throw new ErreurGlossaire('interdit')
  const validation = ComplementSchema.safeParse(entree)
  if (!validation.success) throw new ErreurGlossaire('invalide')
  const { jeu, indicateur, definition, synonymes } = validation.data
  const registre = await registreAutorise(contexte, deps.registre)
  if (!registre.some(e => e.jeu.cle === jeu && e.jeu.mesures.some(m => m.cle === indicateur))) {
    throw new ErreurGlossaire('introuvable')
  }
  const supprime = !definition && synonymes.length === 0
  if (supprime) {
    await prisma.$executeRaw`DELETE FROM warehouse.glossaire WHERE jeu = ${jeu} AND indicateur = ${indicateur}`
  } else {
    await prisma.$executeRaw`
      INSERT INTO warehouse.glossaire (jeu, indicateur, definition, synonymes, modifie_par)
      VALUES (${jeu}, ${indicateur}, ${definition}, ${synonymes}::text[], ${contexte.userId})
      ON CONFLICT (jeu, indicateur) DO UPDATE SET
        definition = EXCLUDED.definition, synonymes = EXCLUDED.synonymes,
        modifie_par = EXCLUDED.modifie_par, modifie_a = clock_timestamp()
    `
  }
  journal.info('glossaire modifié', { jeu, indicateur })
  return { supprime }
}
