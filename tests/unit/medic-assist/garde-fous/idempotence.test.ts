/**
 * Idempotence de l'envoi (R10) et garde-fous de executerChat : renvoi du même id client,
 * relance d'un message resté sans réponse, course d'insertion (P2002), quota journalier
 * (429 `quota_epuise`), référence d'incident sur toutes les erreurs, transaction de fin de
 * tour. Base Prisma en mémoire, modèle simulé.
 */
import { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ajouterConversation,
  ajouterMessage,
  injecterPanne,
  reinitialiserBase,
  tables,
} from './_base-memoire'
import {
  UTILISATEUR,
  configDe,
  contexteDe,
  corpsMessage,
  etapeTexte,
  lireJusquauBout,
  modeleSimule,
} from './_banc-chat'

// Marqueur de test : ZZLBIDEMPOTENCE

const h = vi.hoisted(() => ({
  creerModele: vi.fn(),
  lireConfig: vi.fn(),
  quota: vi.fn(),
}))

vi.mock('@/lib/db/client', async () => {
  const { base } = await import('./_base-memoire')
  return { prisma: base, default: base }
})
vi.mock('@/lib/medic-assist/config', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/config')>()),
  creerModele: h.creerModele,
  lireConfigMedicAssist: h.lireConfig,
}))
vi.mock('@/lib/medic-assist/agent/quota', () => ({ verifierQuotaJournalier: h.quota }))
vi.mock('@/lib/medic-assist/agent/reference', () => ({ genererReference: () => 'DG-TEST02' }))
vi.mock('@/lib/medic-assist/agent/outils-adaptateur', () => ({ creerOutilsReels: () => ({}) }))
vi.mock('@/lib/medic-assist/donnees/outils', () => ({
  resumeCatalogueCompact: async () => 'Catalogue de test',
}))

import { executerChat } from '@/lib/medic-assist/agent/executer'
import { enregistrerFinDeTour } from '@/lib/medic-assist/agent/persistance'

const contexte = contexteDe()
let appelsModele = 0

function chat(corps: unknown) {
  return executerChat({ contexte, corps })
}

/** Lignes JSON écrites par le journal structuré sur un canal de la console. */
function lignesJournal(canal: 'error' | 'warn' | 'info'): Array<Record<string, unknown>> {
  return vi
    .mocked(console[canal])
    .mock.calls.map(appel => JSON.parse(String(appel[0])) as Record<string, unknown>)
}

beforeEach(() => {
  reinitialiserBase()
  appelsModele = 0
  h.lireConfig.mockResolvedValue(configDe())
  h.quota.mockResolvedValue({ autorise: true })
  h.creerModele.mockImplementation(() =>
    modeleSimule(() => {
      appelsModele += 1
      return etapeTexte('Réponse')
    })
  )
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renvoi du même id client', () => {
  it("l'id client est enregistré, la clé primaire reste celle du serveur", async () => {
    const resultat = await chat(corpsMessage('client-1'))
    await lireJusquauBout(resultat)
    const question = tables.messages.find(m => m.role === 'user')!
    expect(question.idClient).toBe('client-1')
    expect(question.id).not.toBe('client-1')
    expect(question.id).toMatch(/^msg/)
  })

  it('message déjà suivi d’une réponse -> 409 message_deja_recu, aucun 2e tour', async () => {
    const premier = await chat(corpsMessage('client-1'))
    if (premier.type !== 'flux') throw new Error('flux attendu')
    await lireJusquauBout(premier)
    expect(appelsModele).toBe(1)
    expect(tables.messages).toHaveLength(2)
    const usagesAvant = tables.usages.length // tour + titre de la nouvelle conversation

    const doublon = await chat(corpsMessage('client-1', { conversationId: premier.conversationId }))
    expect(doublon).toMatchObject({
      type: 'erreur',
      statut: 409,
      corps: { error: 'message_deja_recu', details: { reference: 'DG-TEST02' } },
    })
    expect(appelsModele).toBe(1)
    expect(tables.messages).toHaveLength(2)
    expect(tables.usages).toHaveLength(usagesAvant)
    // Le verrou pris pour lire l'historique est relâché.
    expect(tables.conversations[0].tourEnCoursJusqua).toBeNull()
  })

  it('dernier message sans réponse (échec précédent) : tour relancé sans réinsertion', async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    ajouterMessage({
      conversationId: conv.id as string,
      role: 'user',
      idClient: 'client-2',
      parts: [{ type: 'text', text: 'Question restée sans réponse' }],
      metadonnees: { conversationId: conv.id, creeA: new Date().toISOString(), piecesJointesIds: [], piecesJointes: [] },
    })

    const relance = await chat(corpsMessage('client-2', { conversationId: conv.id }))
    expect(relance.type).toBe('flux')
    await lireJusquauBout(relance)

    expect(appelsModele).toBe(1)
    expect(tables.messages.filter(m => m.role === 'user')).toHaveLength(1)
    expect(tables.messages.filter(m => m.role === 'assistant')).toHaveLength(1)
    expect(conv.tourEnCoursJusqua).toBeNull()
  })

  it('relance refusée si un tour est encore en cours (409 tour_en_cours)', async () => {
    const conv = ajouterConversation({
      userId: UTILISATEUR,
      tourEnCoursJusqua: new Date(Date.now() + 60_000),
    })
    ajouterMessage({ conversationId: conv.id as string, role: 'user', idClient: 'client-3' })
    const resultat = await chat(corpsMessage('client-3', { conversationId: conv.id }))
    expect(resultat).toMatchObject({ statut: 409, corps: { error: 'tour_en_cours' } })
    expect(appelsModele).toBe(0)
  })

  it("message suivi d'un autre message -> 409 message_deja_recu", async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    ajouterMessage({ conversationId: conv.id as string, role: 'user', idClient: 'client-4' })
    ajouterMessage({ conversationId: conv.id as string, role: 'user', idClient: 'client-5' })
    const resultat = await chat(corpsMessage('client-4', { conversationId: conv.id }))
    expect(resultat).toMatchObject({ statut: 409, corps: { error: 'message_deja_recu' } })
    expect(appelsModele).toBe(0)
  })

  it('course d’insertion (P2002) -> 409 message_deja_recu et verrou libéré', async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    injecterPanne(
      'message.create',
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      })
    )
    const resultat = await chat(corpsMessage('client-6', { conversationId: conv.id }))
    expect(resultat).toMatchObject({
      statut: 409,
      corps: { error: 'message_deja_recu', details: { reference: 'DG-TEST02' } },
    })
    expect(appelsModele).toBe(0)
    expect(conv.tourEnCoursJusqua).toBeNull()
  })

  it('le même id client dans une AUTRE conversation reste accepté', async () => {
    const a = ajouterConversation({ userId: UTILISATEUR })
    const b = ajouterConversation({ userId: UTILISATEUR })
    ajouterMessage({ conversationId: a.id as string, role: 'user', idClient: 'client-7' })
    ajouterMessage({ conversationId: a.id as string, role: 'assistant' })
    const resultat = await chat(corpsMessage('client-7', { conversationId: b.id }))
    expect(resultat.type).toBe('flux')
    await lireJusquauBout(resultat)
  })

  it("la régénération n'est pas soumise à l'idempotence de l'envoi", async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    ajouterMessage({ conversationId: conv.id as string, role: 'user', idClient: 'client-8' })
    const ancienne = ajouterMessage({ conversationId: conv.id as string, role: 'assistant' })
    const resultat = await chat({
      ...corpsMessage('client-8', { conversationId: conv.id }),
      trigger: 'regenerate-message',
      messageId: ancienne.id,
    })
    expect(resultat.type).toBe('flux')
    await lireJusquauBout(resultat)
    await vi.waitFor(() =>
      expect(tables.messages.filter(m => m.role === 'assistant').map(m => m.id)).not.toContain(
        ancienne.id
      )
    )
    expect(appelsModele).toBe(1)
  })
})

describe('quota journalier', () => {
  it('quota atteint -> 429 quota_epuise avec référence, rien écrit ni appelé', async () => {
    const reinitialisationA = new Date('2026-11-13T23:00:00.000Z')
    h.quota.mockResolvedValue({ autorise: false, plafondUsd: 5, consommeUsd: 5.2, reinitialisationA })
    const resultat = await chat(corpsMessage('client-q'))
    expect(resultat).toEqual({
      type: 'erreur',
      statut: 429,
      corps: {
        error: 'quota_epuise',
        message: 'Daily AI cost limit reached',
        details: {
          reference: 'DG-TEST02',
          reinitialisationA: '2026-11-13T23:00:00.000Z',
          plafondUsd: 5,
        },
      },
    })
    expect(h.quota).toHaveBeenCalledWith(UTILISATEUR, 10)
    expect(tables.conversations).toHaveLength(0)
    expect(appelsModele).toBe(0)
    expect(lignesJournal('error')).toContainEqual(
      expect.objectContaining({
        niveau: 'erreur',
        reference: 'DG-TEST02',
        code: 'quota_epuise',
        userId: UTILISATEUR,
      })
    )
  })

  it('le quota s’applique aussi à la régénération, sans prendre le verrou', async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    ajouterMessage({ conversationId: conv.id as string, role: 'user' })
    const reponse = ajouterMessage({ conversationId: conv.id as string, role: 'assistant' })
    h.quota.mockResolvedValue({
      autorise: false,
      plafondUsd: 1,
      consommeUsd: 3,
      reinitialisationA: new Date('2026-11-13T23:00:00Z'),
    })
    const resultat = await chat({
      conversationId: conv.id,
      trigger: 'regenerate-message',
      messageId: reponse.id,
    })
    expect(resultat).toMatchObject({ statut: 429, corps: { error: 'quota_epuise' } })
    expect(conv.tourEnCoursJusqua).toBeNull()
    expect(tables.messages).toHaveLength(2)
  })

  it('plafond 0 = désactivé : vraie vérification, aucune requête de somme', async () => {
    const reel = await vi.importActual<typeof import('@/lib/medic-assist/agent/quota')>(
      '@/lib/medic-assist/agent/quota'
    )
    h.quota.mockImplementation(reel.verifierQuotaJournalier)
    h.lireConfig.mockResolvedValue(configDe({ plafondCoutJournalierUsd: 0 }))
    // La base en mémoire n'a pas d'`aggregate` : une requête ferait échouer le tour (500).
    const resultat = await chat(corpsMessage('client-0'))
    expect(resultat.type).toBe('flux')
    await lireJusquauBout(resultat)
    expect(h.quota).toHaveBeenCalledWith(UTILISATEUR, 0)
  }, 60_000) // import réel du module de quota (et de ses dépendances) : lent à froid
})

describe('référence d’incident sur toutes les erreurs', () => {
  it('400 de validation : référence fusionnée avec le détail du schéma', async () => {
    const resultat = await chat({ message: { id: '', role: 'user', parts: [] } })
    if (resultat.type !== 'erreur') throw new Error('erreur attendue')
    expect(resultat.statut).toBe(400)
    expect(resultat.corps.details).toMatchObject({ reference: 'DG-TEST02', fieldErrors: expect.any(Object) })
  })

  it('404 de conversation inconnue et 503 sans clé portent la référence', async () => {
    const inconnue = await chat(corpsMessage('client-i', { conversationId: 'conv_inconnue' }))
    expect(inconnue).toMatchObject({
      statut: 404,
      corps: { error: 'not_found', details: { reference: 'DG-TEST02' } },
    })

    const { ErreurFournisseurAbsent } = await import('@/lib/medic-assist/config')
    h.creerModele.mockImplementation(() => {
      throw new ErreurFournisseurAbsent()
    })
    const sansCle = await chat(corpsMessage('client-j'))
    expect(sansCle).toMatchObject({
      statut: 503,
      corps: { error: 'fournisseur_non_configure', details: { reference: 'DG-TEST02' } },
    })
  })
})

describe('transaction de fin de tour', () => {
  const usage = {
    fournisseur: 'anthropic',
    modele: 'claude-sonnet-5-5',
    mode: 'standard' as const,
    usage: { entree: 100, sortie: 20 },
    coutUsd: 0.01,
    dureeMs: 1200,
  }

  it('tout est écrit ensemble : message, usages, dernierMessageA', async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    const resultat = await enregistrerFinDeTour({
      userId: UTILISATEUR,
      conversationId: conv.id as string,
      message: { id: 'msg-fin', parts: [{ type: 'text', text: 'Réponse' }], metadonnees: {} },
      usage,
      usagesModeles: [{ ...usage, fournisseur: 'openai', modele: 'gpt-6.1-sol', dureeMs: 0 }],
      usagesAnnexes: [{ ...usage, mode: 'rapide', modele: 'claude-haiku-5-5' }],
    })
    expect(resultat).toEqual({ messageEnregistre: true, usageEnregistre: true, actionsRattachees: 0 })
    expect(tables.messages.map(m => m.id)).toEqual(['msg-fin'])
    expect(tables.usages.map(u => [u.modele, u.messageId])).toEqual([
      ['claude-sonnet-5-5', 'msg-fin'],
      ['gpt-6.1-sol', 'msg-fin'],
      ['claude-haiku-5-5', null],
    ])
  })

  it('échec dans la transaction : rien de partiel, usages retentés seuls hors transaction', async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    // Le 1er create d'usage (dans la transaction) échoue : le message est annulé avec elle.
    injecterPanne('usage.create')
    const resultat = await enregistrerFinDeTour({
      userId: UTILISATEUR,
      conversationId: conv.id as string,
      message: { id: 'msg-perdu', parts: [{ type: 'text', text: 'Réponse' }], metadonnees: {} },
      usage,
      usagesAnnexes: [{ ...usage, mode: 'rapide', modele: 'claude-haiku-5-5' }],
    })
    expect(resultat).toEqual({ messageEnregistre: false, usageEnregistre: true, actionsRattachees: 0 })
    expect(tables.messages).toHaveLength(0)
    expect(tables.usages.map(u => [u.modele, u.messageId])).toEqual([
      ['claude-sonnet-5-5', null],
      ['claude-haiku-5-5', null],
    ])
    expect(lignesJournal('error')).toContainEqual(
      expect.objectContaining({
        niveau: 'erreur',
        evenement: 'fin_de_tour_non_enregistree',
        erreur: 'Error',
      })
    )
  })
})
