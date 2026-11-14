/**
 * Garde-fous de l'assistant IA sur une vraie base PostgreSQL (lot B, R10) : contrainte unique
 * (conversationId, idClient), verrou du tour pris par UPDATE conditionnel (deux prises
 * concurrentes, expiration), transaction de fin de tour. Lancé par `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  enregistrerFinDeTour,
  enregistrerMessageUtilisateur,
  estViolationUnicite,
} from '@/lib/medic-assist/agent/persistance'
import {
  DUREE_VERROU_MS,
  compterToursEnCours,
  libererVerrou,
  prendreVerrouConversation,
} from '@/lib/medic-assist/agent/verrou'

const testActif = process.env.DATAGENIUS_TEST_POSTGRES === '1'

describe.skipIf(!testActif)('Garde-fous de l’assistant · PostgreSQL', () => {
  const userId = randomUUID()

  async function conversation(): Promise<string> {
    const c = await prisma.assistantConversation.create({ data: { userId, titre: 'Garde-fous' } })
    return c.id
  }

  const metadonnees = (conversationId: string) => ({
    conversationId,
    creeA: new Date().toISOString(),
    piecesJointesIds: [],
    piecesJointes: [],
  })

  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') {
      throw new Error('Utiliser la base fictive dg_app.')
    }
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.test`, passwordHash: '', firstName: 'Garde' },
    })
  })

  afterAll(async () => {
    if (testActif && new URL(process.env.DATABASE_URL ?? '').pathname === '/dg_app') {
      await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.$disconnect()
    }
  })

  it('contrainte unique (conversationId, idClient) : P2002 ; NULL et autre conversation acceptés', async () => {
    const a = await conversation()
    const b = await conversation()
    const parts = [{ type: 'text' as const, text: 'Bonjour' }]

    await enregistrerMessageUtilisateur(userId, a, { id: randomUUID(), parts, idClient: 'ui-1' }, metadonnees(a))
    const doublon = enregistrerMessageUtilisateur(
      userId,
      a,
      { id: randomUUID(), parts, idClient: 'ui-1' },
      metadonnees(a)
    )
    await expect(doublon).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    await expect(doublon).rejects.toMatchObject({ code: 'P2002' })
    expect(estViolationUnicite(await doublon.catch(e => e))).toBe(true)

    // Même id client dans une autre conversation : accepté.
    await enregistrerMessageUtilisateur(userId, b, { id: randomUUID(), parts, idClient: 'ui-1' }, metadonnees(b))
    // Sans id client (anciens messages, réponses) : NULL distincts, jamais en conflit.
    await enregistrerMessageUtilisateur(userId, a, { id: randomUUID(), parts }, metadonnees(a))
    await enregistrerMessageUtilisateur(userId, a, { id: randomUUID(), parts }, metadonnees(a))

    expect(await prisma.assistantMessage.count({ where: { conversationId: a } })).toBe(3)
  })

  it('deux prises concurrentes du verrou : une seule réussit', async () => {
    const id = await conversation()
    const maintenant = new Date()
    const prises = await Promise.all(
      Array.from({ length: 5 }, () => prendreVerrouConversation(userId, id, maintenant))
    )
    expect(prises.filter(Boolean)).toHaveLength(1)
    expect(await compterToursEnCours(userId, maintenant)).toBe(1)
    expect(await libererVerrou(prises.find(Boolean))).toBe(true)
    expect(await compterToursEnCours(userId, maintenant)).toBe(0)
  })

  it('expiration : un verrou échu se reprend, l’ancien détenteur ne libère pas le nouveau', async () => {
    const id = await conversation()
    const t0 = new Date()
    const ancien = await prendreVerrouConversation(userId, id, t0)
    expect(ancien).not.toBeNull()
    expect(await prendreVerrouConversation(userId, id, new Date(t0.getTime() + DUREE_VERROU_MS - 1))).toBeNull()

    const nouveau = await prendreVerrouConversation(userId, id, new Date(t0.getTime() + DUREE_VERROU_MS + 1))
    expect(nouveau).not.toBeNull()
    expect(await libererVerrou(ancien)).toBe(false)
    const ligne = await prisma.assistantConversation.findUniqueOrThrow({ where: { id } })
    expect(ligne.tourEnCoursJusqua?.getTime()).toBe(nouveau!.jusqua.getTime())
    expect(await libererVerrou(nouveau)).toBe(true)
  })

  it('fin de tour transactionnelle : échec -> aucun message, usage conservé sans rattachement', async () => {
    const id = await conversation()
    const usage = {
      fournisseur: 'anthropic',
      modele: 'claude-sonnet-5-5',
      mode: 'standard' as const,
      usage: { entree: 100, sortie: 20 },
      coutUsd: 0.01,
      dureeMs: 500,
    }
    const ok = await enregistrerFinDeTour({
      userId,
      conversationId: id,
      message: { id: `msg-${randomUUID()}`, parts: [{ type: 'text', text: 'Réponse' }], metadonnees: {} },
      usage,
    })
    expect(ok).toEqual({ messageEnregistre: true, usageEnregistre: true, actionsRattachees: 0 })

    // Même id de message : la clé primaire refuse, toute la transaction est annulée.
    const existant = await prisma.assistantMessage.findFirstOrThrow({ where: { conversationId: id } })
    const echec = await enregistrerFinDeTour({
      userId,
      conversationId: id,
      message: { id: existant.id, parts: [{ type: 'text', text: 'Doublon' }], metadonnees: {} },
      usage: { ...usage, coutUsd: 0.02 },
    })
    expect(echec).toEqual({ messageEnregistre: false, usageEnregistre: true, actionsRattachees: 0 })
    expect(await prisma.assistantMessage.count({ where: { conversationId: id } })).toBe(1)
    const usages = await prisma.assistantUsage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    })
    expect(usages.map(u => [Number(u.coutUsd), u.messageId])).toEqual([
      [0.01, existant.id],
      [0.02, null],
    ])
  })
})
