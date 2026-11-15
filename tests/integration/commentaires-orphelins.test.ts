import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { getAccessScope } from '@/lib/auth/access-scope'
import {
  ajouterCommentaire,
  ErreurCommentaire,
  LIMITE_COMMENTAIRES,
  purgerCommentairesOrphelins,
} from '@/lib/commentaires/commentaires'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { supprimerConversation } from '@/lib/medic-assist/agent/conversations'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'

const actif = process.env.DATAGENIUS_TEST_POSTGRES === '1'

async function creerCompte(users: string[]) {
  const compte = await prisma.user.create({
    data: { email: `${randomUUID()}@example.test`, firstName: 'Recette', lastName: 'Test', roleName: 'Member', passwordHash: 'fixture' },
  })
  users.push(compte.id)
  return compte.id
}

async function contexte(userId: string): Promise<ContexteExecution> {
  const scope = await getAccessScope(userId)
  if (!scope) throw new Error('Compte indisponible')
  return { userId, roleName: scope.roleName, scope, habilitations: null, locale: 'fr', maintenant: new Date() }
}

const ajouterArtefact = (id: string, userId: string, extra: { racineId?: string; version?: number; conversationId?: string; enregistre?: boolean } = {}) =>
  prisma.assistantArtefact.create({
    data: {
      id, racineId: extra.racineId ?? id, version: extra.version ?? 1, userId, type: 'tableau', titre: 'Analyse de recette',
      spec: {}, jeuxDeDonneesIds: [], conversationId: extra.conversationId ?? null,
      enregistre: extra.enregistre ?? false, enregistreA: extra.enregistre ? new Date() : null,
    },
  })

const commenter = (artefactId: string, auteurId: string, texte = 'note') =>
  prisma.$executeRaw`INSERT INTO warehouse.commentaires_analyses (id, artefact_id, auteur_id, texte)
    VALUES (${randomUUID()}, ${artefactId}, ${auteurId}, ${texte})`

const compter = async (artefactId: string) =>
  (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM warehouse.commentaires_analyses WHERE artefact_id = ${artefactId}`)[0]!.n

describe.skipIf(!actif)('Commentaires : suppression de conversation, purge des orphelins, concurrence', () => {
  afterAll(async () => Promise.all([prisma.$disconnect(), deconnecterPostgres()]))

  it('la suppression d’une conversation retire les commentaires des analyses supprimées et garde les autres', async () => {
    const users: string[] = []
    const artefacts: string[] = []
    const racine = (id = randomUUID()) => (artefacts.push(id), id)
    try {
      const proprio = await creerCompte(users)
      const conversation = await prisma.assistantConversation.create({ data: { userId: proprio, titre: 'Conversation de recette' } })
      const conv = conversation.id

      // Supprimée : artefact non enregistré, jamais épinglé.
      const jetable = racine()
      await ajouterArtefact(jetable, proprio, { conversationId: conv })
      // Conservée : artefact enregistré.
      const garde = racine()
      await ajouterArtefact(garde, proprio, { conversationId: conv, enregistre: true })
      // Racine dont une version subsiste hors de la conversation : ses commentaires restent.
      const multi = racine()
      await ajouterArtefact(multi, proprio, { conversationId: conv })
      await ajouterArtefact(randomUUID(), proprio, { racineId: multi, version: 2 })
      // Racine d'une autre conversation : jamais touchée.
      const autreConv = await prisma.assistantConversation.create({ data: { userId: proprio, titre: 'Autre conversation' } })
      const etranger = racine()
      await ajouterArtefact(etranger, proprio, { conversationId: autreConv.id })

      for (const cible of [jetable, garde, multi, etranger]) {
        await commenter(cible, proprio, 'un')
        await commenter(cible, proprio, 'deux')
      }

      const resultat = await supprimerConversation({ userId: proprio }, conv)
      expect(resultat).not.toBeNull()
      expect(await prisma.assistantConversation.findUnique({ where: { id: conv } })).toBeNull()

      expect(await compter(jetable)).toBe(0)
      expect(await prisma.assistantArtefact.count({ where: { racineId: jetable } })).toBe(0)
      expect(await compter(garde)).toBe(2)
      expect(await compter(multi)).toBe(2)
      expect(await compter(etranger)).toBe(2)
    } finally {
      for (const id of artefacts) await prisma.$executeRaw`DELETE FROM warehouse.commentaires_analyses WHERE artefact_id = ${id}`
      await prisma.assistantArtefact.deleteMany({ where: { userId: { in: users } } })
      await prisma.assistantConversation.deleteMany({ where: { userId: { in: users } } })
      await prisma.user.deleteMany({ where: { id: { in: users } } })
    }
  })

  it('purgerCommentairesOrphelins retire les commentaires sans analyse et garde les autres', async () => {
    const users: string[] = []
    const orphelin = randomUUID()
    const vivant = randomUUID()
    try {
      const auteur = await creerCompte(users)
      await ajouterArtefact(vivant, auteur)
      await commenter(orphelin, auteur, 'a')
      await commenter(orphelin, auteur, 'b')
      await commenter(vivant, auteur, 'c')

      // La table est purgée en entier : le compte exact dépend de l'état de la base, on borne par le bas.
      const retires = await purgerCommentairesOrphelins()
      expect(retires).toBeGreaterThanOrEqual(2)
      expect(await compter(orphelin)).toBe(0)
      expect(await compter(vivant)).toBe(1)
      // Rien à retirer ensuite pour ces objets.
      expect(await purgerCommentairesOrphelins()).toBeGreaterThanOrEqual(0)
      expect(await compter(vivant)).toBe(1)
    } finally {
      await prisma.$executeRaw`DELETE FROM warehouse.commentaires_analyses WHERE artefact_id IN (${orphelin}, ${vivant})`
      await prisma.assistantArtefact.deleteMany({ where: { id: vivant } })
      await prisma.user.deleteMany({ where: { id: { in: users } } })
    }
  })

  it('le quota est exact en ajouts simultanés : 10 réussissent, 5 sont refusés', async () => {
    const users: string[] = []
    const racineId = randomUUID()
    try {
      const auteur = await creerCompte(users)
      await ajouterArtefact(racineId, auteur)
      const c = await contexte(auteur)
      const essais = 15
      const resultats = await Promise.allSettled(
        Array.from({ length: essais }, (_, i) => ajouterCommentaire(c, racineId, `simultané ${i}`)),
      )
      const reussis = resultats.filter(r => r.status === 'fulfilled')
      const refuses = resultats.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(reussis).toHaveLength(LIMITE_COMMENTAIRES)
      expect(refuses).toHaveLength(essais - LIMITE_COMMENTAIRES)
      for (const refus of refuses) {
        expect(refus.reason).toBeInstanceOf(ErreurCommentaire)
        expect((refus.reason as ErreurCommentaire).code).toBe('limite_debit')
      }
      expect(await compter(racineId)).toBe(LIMITE_COMMENTAIRES)
    } finally {
      await prisma.$executeRaw`DELETE FROM warehouse.commentaires_analyses WHERE artefact_id = ${racineId}`
      await prisma.assistantArtefact.deleteMany({ where: { racineId } })
      await prisma.user.deleteMany({ where: { id: { in: users } } })
    }
  })
})
