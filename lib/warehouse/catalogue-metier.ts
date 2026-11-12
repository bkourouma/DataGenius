import { prisma } from '@/lib/db/client'
import type { Prisma } from '@prisma/client'
import { registrePostgres } from '@/lib/medic-assist/donnees/catalogue/registre'
import { DefinitionMetierSchema, ErreurCatalogueMetier, appliquerPublicationMetier, type DefinitionMetier } from './modele-metier'

export { ErreurCatalogueMetier } from './modele-metier'

async function jeuAdministrable(cle: string, client: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma) {
  const [resultat] = await client.$queryRaw<{ existe: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM warehouse.imports WHERE cle = ${cle}
      UNION ALL SELECT 1 FROM warehouse.combinaisons WHERE cle = ${cle}
    ) AS existe
  `
  return resultat?.existe ?? false
}

export async function chargerCatalogueMetier(cle: string) {
  if (!await jeuAdministrable(cle)) return null
  const [registre, publications] = await Promise.all([
    registrePostgres(),
    prisma.$queryRaw<{ version: number; definition: unknown; publie_a: Date }[]>`
      SELECT version, definition, publie_a FROM warehouse.catalogue_metier
      WHERE jeu = ${cle} ORDER BY version DESC LIMIT 25
    `,
  ])
  const entree = registre.find(e => e.jeu.cle === cle)
  if (!entree) return null
  const publication = publications[0]
  const definition: DefinitionMetier = publication ? DefinitionMetierSchema.parse(publication.definition) : {
    description: entree.jeu.description, grain: entree.jeu.granularite, cles: [],
    dimensions: entree.jeu.dimensions.map(d => d.cle), colonnes: [], mesures: [],
  }
  return {
    jeu: cle, titre: entree.jeu.libelle.fr, colonnes: entree.vue.colonnes, definition,
    version: publication?.version ?? 0,
    historique: publications.map(p => ({ version: p.version, publieA: p.publie_a })),
  }
}

export async function publierCatalogueMetier(cle: string, version: number, entree: unknown, utilisateur: string) {
  const validation = DefinitionMetierSchema.safeParse(entree)
  if (!validation.success) {
    const champ = validation.error.issues[0]?.path.join('.')
    throw new ErreurCatalogueMetier(champ ? `Vérifiez le champ « ${champ} ».` : 'Définition métier invalide.')
  }
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('datagenius:warehouse:combinaisons', 0))::text`
    if (!await jeuAdministrable(cle, tx)) throw new ErreurCatalogueMetier('Ce jeu est indisponible.')
    const [derniere] = await tx.$queryRaw<{ version: number }[]>`
      SELECT version FROM warehouse.catalogue_metier WHERE jeu = ${cle} ORDER BY version DESC LIMIT 1
    `
    const courante = derniere?.version ?? 0
    if (courante !== version) throw new ErreurCatalogueMetier('La définition a changé depuis son ouverture. Rechargez le jeu.')
    const jeu = (await registrePostgres(undefined, tx)).find(e => e.jeu.cle === cle)
    if (!jeu) throw new ErreurCatalogueMetier('Ce jeu est indisponible.')
    const suivante = courante + 1
    appliquerPublicationMetier(jeu, { version: suivante, definition: validation.data })
    await tx.$executeRaw`
      INSERT INTO warehouse.catalogue_metier (jeu, version, definition, publie_par)
      VALUES (${cle}, ${suivante}, ${JSON.stringify(validation.data)}::jsonb, ${utilisateur})
    `
    return suivante
  })
}
