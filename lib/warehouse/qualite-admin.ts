import { prisma } from '@/lib/db/client'
import { registrePostgres } from '@/lib/medic-assist/donnees/catalogue/registre'
import { configurationEntrepot, jeuxEntrepot } from './configuration'
import { definitionQualiteVide, ErreurQualite, validerDefinitionQualite } from './qualite'

export async function chargerQualite(cle: string) {
  const entree = (await jeuxEntrepot()).find(entree => entree.jeu.cle === cle && !entree.source.connexion)
  if (!entree) return null
  const { jeu, empreinte } = entree
  const [[qualite], [etat], historique, registre] = await Promise.all([
    prisma.$queryRaw<{ version: number; definition: unknown }[]>`
      SELECT version, definition FROM warehouse.qualite_imports WHERE jeu = ${cle}
    `,
    prisma.$queryRaw<{ publication: Date | null; derniereReussite: Date | null }[]>`
      SELECT
        (SELECT publie_a FROM warehouse.snapshots WHERE jeu = ${cle} AND empreinte = ${empreinte}) AS publication,
        (SELECT reussi_a FROM warehouse.synchronisations WHERE jeu = ${cle} AND empreinte = ${empreinte}) AS "derniereReussite"
    `,
    prisma.$queryRaw<{
      statut: 'publie' | 'identique' | 'echec'; verifieA: Date; lignesLues: number | null;
      lignesValides: number | null; code: string | null; dureeMs: number; qualiteVersion: number;
      modeLecture: 'delta' | 'reconciliation' | null;
    }[]>`
      SELECT statut, verifie_a AS "verifieA", lignes_lues AS "lignesLues", lignes_valides AS "lignesValides",
        code, duree_ms AS "dureeMs", qualite_version AS "qualiteVersion", mode_lecture AS "modeLecture"
      FROM warehouse.executions WHERE jeu = ${cle} ORDER BY verifie_a DESC, id DESC LIMIT 30
    `,
    registrePostgres(),
  ])
  const dependances = registre.filter(({ vue }) => vue.jeu !== cle && vue.snapshots?.some(snapshot => snapshot.jeu === cle))
    .map(({ jeu }) => ({ cle: jeu.cle, titre: jeu.libelle.fr }))
  return {
    cle, titre: jeu.titre, colonnes: jeu.colonnes,
    version: qualite?.version ?? 0,
    definition: qualite ? validerDefinitionQualite(jeu, qualite.definition) : definitionQualiteVide,
    historique, dependances, publication: etat.publication, derniereReussite: etat.derniereReussite,
    frequenceMinutes: jeu.frequenceMinutes,
    incrementalPossible: 'type' in entree.source && entree.source.type === 'postgresql',
  }
}

export async function enregistrerQualite(cle: string, version: number, entree: unknown) {
  if (!Number.isSafeInteger(version) || version < 0) throw new ErreurQualite('Version de préparation invalide.')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'datagenius:warehouse:' + cle}, 0))::text`
    const { jeux } = await configurationEntrepot(tx)
    const jeu = jeux.find(entree => entree.jeu.cle === cle && !entree.source.connexion)?.jeu
    if (!jeu) throw new ErreurQualite('Cet import est indisponible.')
    const definition = validerDefinitionQualite(jeu, entree)
    const [actuelle] = await tx.$queryRaw<{ version: number }[]>`
      SELECT version FROM warehouse.qualite_imports WHERE jeu = ${cle}
    `
    if ((actuelle?.version ?? 0) !== version) throw new ErreurQualite('La préparation a changé. Rechargez l’import avant de réessayer.')
    await tx.$executeRaw`
      INSERT INTO warehouse.qualite_imports (jeu, version, definition)
      VALUES (${cle}, ${version + 1}, ${JSON.stringify(definition)}::jsonb)
      ON CONFLICT (jeu) DO UPDATE SET version = EXCLUDED.version, definition = EXCLUDED.definition
    `
  })
}
