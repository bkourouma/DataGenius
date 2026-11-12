import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { registreAutorise } from '@/lib/medic-assist/donnees/catalogue/autorisation'
import { registrePostgres } from '@/lib/medic-assist/donnees/catalogue/registre'

const identifiant = z.string().uuid()
const definitionEspace = z.object({
  nom: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300),
  groupes: z.array(identifiant).max(50),
  jeux: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)).max(100),
})

export class ErreurEspace extends Error {}

export async function definitionsEspaces() {
  return prisma.$queryRaw<{ id: string; nom: string; description: string; version: number; groupes: string[]; jeux: string[] }[]>`
    SELECT e.id::text, e.nom, e.description, e.version,
      ARRAY(SELECT groupe_id::text FROM warehouse.espaces_groupes WHERE espace_id = e.id ORDER BY groupe_id) AS groupes,
      ARRAY(SELECT jeu FROM warehouse.espaces_jeux WHERE espace_id = e.id ORDER BY jeu) AS jeux
    FROM warehouse.espaces e ORDER BY e.nom
  `
}

export async function listerEspaces(contexte: ContexteExecution) {
  const [espaces, registre] = await Promise.all([definitionsEspaces(), registreAutorise(contexte)])
  const titres = new Map(registre.map(e => [e.jeu.cle, e.jeu.libelle[contexte.locale]]))
  return espaces.map(({ id, nom, description, jeux }) => ({
    id, nom, description, jeux: jeux.filter(cle => titres.has(cle)).map(cle => ({ cle, titre: titres.get(cle)! })),
  })).filter(espace => espace.jeux.length)
}

export async function enregistrerEspace(acteur: string, cle: string | null, version: number, entree: unknown) {
  const { nom, description, ...selection } = definitionEspace.parse(entree)
  const id = cle ? identifiant.parse(cle) : randomUUID()
  const groupes = [...new Set(selection.groupes)].sort()
  const jeux = [...new Set(selection.jeux)].sort()
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('datagenius:warehouse:combinaisons', 0))::text`
    await tx.$queryRaw`SELECT id FROM warehouse.revision_acces WHERE id = 1 FOR UPDATE`
    const autreNom = await tx.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM warehouse.espaces WHERE nom = ${nom} AND id <> ${id}::uuid) AS existe
    `
    if (autreNom[0]?.existe) throw new ErreurEspace('Un espace porte déjà ce nom.')
    if (groupes.length) {
      const valides = await tx.$queryRaw<{ nombre: number }[]>`
        SELECT count(*)::int AS nombre FROM warehouse.groupes_acces
        WHERE id IN (${Prisma.join(groupes.map(g => Prisma.sql`${g}::uuid`))})
      `
      if (valides[0]?.nombre !== groupes.length) throw new ErreurEspace('Un groupe sélectionné est indisponible.')
    }
    if (jeux.length) {
      const registre = await registrePostgres(undefined, tx)
      const cles = new Set(registre.map(e => e.jeu.cle))
      if (jeux.some(jeu => !cles.has(jeu))) throw new ErreurEspace('Un jeu sélectionné est indisponible.')
      const [conflit] = await tx.$queryRaw<{ existe: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM warehouse.espaces_jeux WHERE jeu IN (${Prisma.join(jeux)}) AND espace_id <> ${id}::uuid) AS existe
      `
      if (conflit?.existe) throw new ErreurEspace('Retirez d’abord le jeu de son espace actuel.')
    }
    if (cle) {
      const modifie = await tx.$executeRaw`
        UPDATE warehouse.espaces SET nom = ${nom}, description = ${description}, version = version + 1
        WHERE id = ${id}::uuid AND version = ${version}
      `
      if (!modifie) throw new ErreurEspace('L’espace a changé. Rechargez la page.')
    } else {
      await tx.$executeRaw`INSERT INTO warehouse.espaces (id, nom, description) VALUES (${id}::uuid, ${nom}, ${description})`
    }
    const [anciens] = await tx.$queryRaw<{ groupes: string[]; jeux: string[] }[]>`
      SELECT ARRAY(SELECT groupe_id::text FROM warehouse.espaces_groupes WHERE espace_id = ${id}::uuid ORDER BY groupe_id) AS groupes,
             ARRAY(SELECT jeu FROM warehouse.espaces_jeux WHERE espace_id = ${id}::uuid ORDER BY jeu) AS jeux
    `
    if (JSON.stringify([anciens.groupes, anciens.jeux]) !== JSON.stringify([groupes, jeux])) {
      await tx.$executeRaw`DELETE FROM warehouse.espaces_groupes WHERE espace_id = ${id}::uuid`
      await tx.$executeRaw`DELETE FROM warehouse.espaces_jeux WHERE espace_id = ${id}::uuid`
      if (groupes.length) await tx.$executeRaw`
        INSERT INTO warehouse.espaces_groupes (espace_id, groupe_id)
        VALUES ${Prisma.join(groupes.map(g => Prisma.sql`(${id}::uuid, ${g}::uuid)`))}`
      if (jeux.length) await tx.$executeRaw`
        INSERT INTO warehouse.espaces_jeux (espace_id, jeu)
        VALUES ${Prisma.join(jeux.map(jeu => Prisma.sql`(${id}::uuid, ${jeu})`))}`
      if (anciens.jeux.length || jeux.length) await tx.$executeRaw`
        UPDATE warehouse.revision_acces SET revision = revision + 1, depuis = clock_timestamp() WHERE id = 1`
    }
    await tx.$executeRaw`
      INSERT INTO warehouse.audit_acces (acteur_id, action, objet)
      VALUES (${acteur}, ${cle ? 'Espace modifié' : 'Espace créé'}, ${nom})`
    return id
  })
}
