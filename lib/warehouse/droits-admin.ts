import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { regleDonneesSchema } from '@/lib/auth/data-access'
import { prisma } from '@/lib/db/client'
import { registrePostgres } from '@/lib/medic-assist/donnees/catalogue/registre'

export class ErreurDroits extends Error {}

async function auditer(tx: Prisma.TransactionClient, acteur: string, action: string, objet: string, revision: boolean) {
  if (revision) {
    await tx.$executeRaw`UPDATE warehouse.revision_acces SET revision = revision + 1, depuis = clock_timestamp() WHERE id = 1`
  }
  await tx.$executeRaw`INSERT INTO warehouse.audit_acces (acteur_id, action, objet) VALUES (${acteur}, ${action}, ${objet})`
}

export async function configurationDroits() {
  const [groupes, membres, regles, registre, audit] = await Promise.all([
    prisma.$queryRaw<{ id: string; nom: string; membres: string[] }[]>`
      SELECT g.id::text, g.nom, ARRAY(SELECT m.utilisateur_id FROM warehouse.membres_groupes m WHERE m.groupe_id = g.id) AS membres
      FROM warehouse.groupes_acces g ORDER BY g.nom`,
    prisma.user.findMany({ where: { status: 'active', deletedAt: null, roleName: 'Member' },
      select: { id: true, email: true, firstName: true, lastName: true }, orderBy: { email: 'asc' } }),
    prisma.$queryRaw<{ jeu: string; definition: unknown }[]>`SELECT jeu, definition FROM warehouse.regles_acces`,
    registrePostgres(),
    prisma.$queryRaw<{ id: string; acteur: string; action: string; objet: string; fait_a: Date }[]>`
      SELECT a.id::text, COALESCE(u.email, a.acteur_id) AS acteur, a.action, a.objet, a.fait_a
      FROM warehouse.audit_acces a LEFT JOIN public.users u ON u.id = a.acteur_id ORDER BY a.id DESC LIMIT 25`,
  ])
  return { groupes, membres, audit, regles: new Map(regles.map(r => [r.jeu, regleDonneesSchema.parse(r.definition)])),
    jeux: registre.map(({ jeu, vue }) => ({ cle: jeu.cle, titre: jeu.libelle.fr, colonnes: vue.colonnes })) }
}

const nomGroupe = z.string().trim().min(1).max(100)
const idGroupe = z.string().uuid()

export async function creerGroupe(acteur: string, entree: unknown) {
  const nom = nomGroupe.parse(entree)
  const id = randomUUID()
  await prisma.$transaction(async tx => {
    const compte = await tx.$executeRaw`INSERT INTO warehouse.groupes_acces (id, nom) VALUES (${id}::uuid, ${nom}) ON CONFLICT (nom) DO NOTHING`
    if (!compte) throw new ErreurDroits('Un groupe porte déjà ce nom.')
    await auditer(tx, acteur, 'Groupe créé', id, false)
  })
  return id
}

export async function modifierGroupe(acteur: string, idBrut: unknown, nomBrut: unknown, idsBruts: unknown[]) {
  const id = idGroupe.parse(idBrut)
  const nom = nomGroupe.parse(nomBrut)
  const membres = [...new Set(z.array(z.string().min(1).max(100)).max(2000).parse(idsBruts))].sort()
  await prisma.$transaction(async tx => {
    const [groupe] = await tx.$queryRaw<{ nom: string }[]>`
      SELECT nom FROM warehouse.groupes_acces WHERE id = ${id}::uuid FOR UPDATE`
    if (!groupe) throw new ErreurDroits('Ce groupe est introuvable.')
    const valides = await tx.user.count({ where: { id: { in: membres }, status: 'active', deletedAt: null, roleName: 'Member' } })
    if (valides !== membres.length) throw new ErreurDroits('Rechargez la page. Certains membres sont indisponibles.')
    if (nom !== groupe.nom) {
      const [existant] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM warehouse.groupes_acces WHERE nom = ${nom}`
      if (existant) throw new ErreurDroits('Un groupe porte déjà ce nom.')
      await tx.$executeRaw`UPDATE warehouse.groupes_acces SET nom = ${nom} WHERE id = ${id}::uuid`
      await auditer(tx, acteur, 'Groupe renommé', id, false)
    }
    const anciens = await tx.$queryRaw<{ utilisateur_id: string }[]>`
      SELECT utilisateur_id FROM warehouse.membres_groupes WHERE groupe_id = ${id}::uuid`
    const avant = new Set(anciens.map(m => m.utilisateur_id))
    const apres = new Set(membres)
    const ajoutes = membres.filter(m => !avant.has(m))
    const retires = [...avant].filter(m => !apres.has(m))
    if (retires.length) await tx.$executeRaw`DELETE FROM warehouse.membres_groupes WHERE groupe_id = ${id}::uuid AND utilisateur_id IN (${Prisma.join(retires)})`
    if (ajoutes.length) await tx.$executeRaw`
      INSERT INTO warehouse.membres_groupes (groupe_id, utilisateur_id) VALUES ${Prisma.join(ajoutes.map(m => Prisma.sql`(${id}::uuid, ${m})`))}`
    if (retires.length || ajoutes.length) await auditer(tx, acteur, 'Membres modifiés', id, true)
  })
}

export async function modifierRegle(acteur: string, jeuBrut: unknown, entree: unknown) {
  const cle = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).parse(jeuBrut)
  const regle = entree === null ? null : regleDonneesSchema.parse(entree)
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('datagenius:warehouse:combinaisons', 0))::text`
    await tx.$queryRaw`SELECT id FROM warehouse.revision_acces WHERE id = 1 FOR UPDATE`
    if (!regle) {
      const retire = await tx.$executeRaw`DELETE FROM warehouse.regles_acces WHERE jeu = ${cle}`
      if (retire) await auditer(tx, acteur, 'Accès ouvert', cle, true)
      return
    }
    const entreeJeu = (await registrePostgres(undefined, tx)).find(j => j.jeu.cle === cle)
    if (!entreeJeu) throw new ErreurDroits('Ce jeu est introuvable.')
    const colonnes = new Set(entreeJeu.vue.colonnes.map(c => c.nom))
    if (regle.masquer.some(c => !colonnes.has(c)) || (regle.filtre && !colonnes.has(regle.filtre.colonne))) {
      throw new ErreurDroits('Une colonne sélectionnée est indisponible.')
    }
    regle.groupes = [...new Set(regle.groupes)].sort()
    regle.masquer = [...new Set(regle.masquer)].sort()
    const groupes = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM warehouse.groupes_acces`
    const ids = new Set(groupes.map(g => g.id))
    if (regle.groupes.some(g => !ids.has(g))) throw new ErreurDroits('Un groupe sélectionné est indisponible.')
    if (regle.masquer.length === colonnes.size) throw new ErreurDroits('Conservez au moins une colonne visible.')
    const change = await tx.$executeRaw`
      INSERT INTO warehouse.regles_acces (jeu, definition) VALUES (${cle}, ${JSON.stringify(regle)}::jsonb)
      ON CONFLICT (jeu) DO UPDATE SET definition = EXCLUDED.definition
      WHERE regles_acces.definition IS DISTINCT FROM EXCLUDED.definition`
    if (change) await auditer(tx, acteur, 'Accès restreint', cle, true)
  })
}
