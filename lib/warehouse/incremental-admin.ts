import { prisma } from '@/lib/db/client'
import { configurationEntrepot } from './configuration'
import { validerDefinitionIncrementale, verifierCurseur, type DefinitionIncrementale } from './incremental'

export async function chargerIncremental(cle: string) {
  const { jeux } = await configurationEntrepot()
  const entree = jeux.find(e => e.jeu.cle === cle && 'type' in e.source && e.source.type === 'postgresql' && !e.source.connexion)
  if (!entree) return null
  const [etat] = await prisma.$queryRaw<{
    version: number; definition: DefinitionIncrementale; curseur: string | null; reconcilie_a: Date | null
  }[]>`
    SELECT version, definition, curseur, reconcilie_a FROM warehouse.incremental WHERE jeu = ${cle}
  `
  return { cle, titre: entree.jeu.titre, colonnes: entree.jeu.colonnes, etat: etat ?? null }
}

export async function enregistrerIncremental(cle: string, version: number, entree: unknown | null) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'datagenius:warehouse:' + cle}, 0))::text`
    const { jeux } = await configurationEntrepot(tx)
    const jeu = jeux.find(e => e.jeu.cle === cle && 'type' in e.source && e.source.type === 'postgresql' && !e.source.connexion)
    if (!jeu) throw new Error('Cet import PostgreSQL est indisponible.')
    const [actuelle] = await tx.$queryRaw<{ version: number }[]>`
      SELECT version FROM warehouse.incremental WHERE jeu = ${cle}
    `
    if ((actuelle?.version ?? 0) !== version) throw new Error('La configuration a changé. Rechargez cet import.')
    if (entree === null) {
      await tx.$executeRaw`DELETE FROM warehouse.incremental WHERE jeu = ${cle}`
      return
    }
    const definition = validerDefinitionIncrementale(jeu, entree)
    await verifierCurseur(jeu, definition)
    await tx.$executeRaw`
      INSERT INTO warehouse.incremental (jeu, definition)
      VALUES (${cle}, ${JSON.stringify(definition)}::jsonb)
      ON CONFLICT (jeu) DO UPDATE SET version = EXCLUDED.version, definition = EXCLUDED.definition,
        empreinte = NULL, contenu = NULL, curseur = NULL, reconcilie_a = NULL
    `
  }, { timeout: 25_000 })
}
